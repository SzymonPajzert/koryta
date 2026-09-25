import { beforeEach, describe, expect, it, vi } from "vitest";
import listHandler from "../../../../server/api/contracts/powiazania/index.get";
import detailHandler from "../../../../server/api/contracts/powiazania/[id].get";
import ingestHandler from "../../../../server/api/ingest/contracts/powiazania.post";
import contractIngestHandler from "../../../../server/api/ingest/contracts/powiazania/umowy.post";
import {
  CONTRACT_LINK_CONTRACT_COLLECTION,
  computeContractLinkSummary,
  contractLinkPayloadSchema,
  toContractLinkDoc,
} from "../../../../server/utils/contractLinks";
import { toContractDoc } from "../../../../server/utils/contracts";
import { requireDatascience } from "../../../../server/utils/auth";
import payloads from "../../../../scripts/contract_links.json";
import contractPayloads from "../../../../scripts/contract_link_contracts.json";
import type {
  ContractLink,
  ContractLinkItem,
  ContractLinkListResponse,
  ContractLinkStrength,
} from "../../../../shared/contractLinks";

/** The findings routes against an in-memory Firestore, as an anonymous and as
 * a signed-in reader. What the anonymous half checks is the serialised
 * response - every byte a crawler or a curious reader could keep - not a flag
 * on it. */

type Data = Record<string, unknown>;
const store: Record<string, Map<string, Data>> = {};

function collectionOf(name: string): Map<string, Data> {
  return (store[name] ??= new Map());
}

function valueAt(data: Data, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

type Ref = { id: string; collection: string };

function snapshotOf(name: string, id: string) {
  const data = collectionOf(name).get(id);
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    ref: { id, collection: name } as Ref,
  };
}

/** Document ids whose writes and deletes fail, as a BulkWriter's do once its
 * retries are spent: the promise the call returned rejects, and `close()`
 * resolves regardless. */
const failing = new Set<string>();

function bulkWrite(ref: Ref, write: () => void): Promise<void> {
  if (failing.has(ref.id))
    return Promise.reject(new Error("DEADLINE_EXCEEDED"));
  write();
  return Promise.resolve();
}

type QueryState = {
  filters: [string, unknown][];
  orders: [string, "asc" | "desc"][];
  after: unknown[] | null;
  limit: number;
};

/** A query the way Firestore runs one: equality filters, the declared orders
 * with the document id appended in the direction of the last, a document
 * missing an ordered field left out, and `startAfter` values compared against
 * the declared orders only - so a cursor that relied on the id to break a tie
 * would page wrongly here as it does there. */
function query(name: string, state: QueryState) {
  const next = (patch: Partial<QueryState>) =>
    query(name, { ...state, ...patch });
  return {
    where: (field: string, op: string, value: unknown) => {
      if (op !== "==") throw new Error(`unsupported operator ${op}`);
      return next({ filters: [...state.filters, [field, value]] });
    },
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      next({ orders: [...state.orders, [field, direction]] }),
    startAfter: (...values: unknown[]) => {
      if (values.length > state.orders.length) {
        throw new Error(
          "Too many cursor values specified. The specified values must " +
            "match the orderBy() constraints of the query.",
        );
      }
      return next({ after: values });
    },
    limit: (count: number) => next({ limit: count }),
    select: () => next({}),
    get: async () => {
      const orders: [string, "asc" | "desc"][] = [
        ...state.orders,
        ["__name__", state.orders.at(-1)?.[1] ?? "asc"],
      ];
      const valueOf = ([id, data]: [string, Data], field: string) =>
        field === "__name__" ? id : valueAt(data, field);
      const order = (a: [string, Data], b: [string, Data], upTo: number) => {
        for (const [field, direction] of orders.slice(0, upTo)) {
          const result = compare(valueOf(a, field), valueOf(b, field));
          if (result) return direction === "desc" ? -result : result;
        }
        return 0;
      };
      let rows = [...collectionOf(name)]
        .filter(([, data]) =>
          state.filters.every(
            ([field, value]) => valueAt(data, field) === value,
          ),
        )
        .filter(([, data]) =>
          state.orders.every(([field]) => valueAt(data, field) !== undefined),
        )
        .sort((a, b) => order(a, b, orders.length));
      if (state.after) {
        const after = state.after;
        rows = rows.filter((row) => {
          for (const [index, value] of after.entries()) {
            const [field, direction] = orders[index]!;
            const result = compare(valueOf(row, field), value);
            if (result) return (direction === "desc" ? -result : result) > 0;
          }
          return false;
        });
      }
      const docs = rows
        .slice(0, state.limit)
        .map(([id]) => snapshotOf(name, id));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
}

const fakeDb = {
  collection: (name: string) => ({
    ...query(name, { filters: [], orders: [], after: null, limit: Infinity }),
    doc: (id: string) => ({
      id,
      collection: name,
      get: async () => snapshotOf(name, id),
      set: async (data: Data) => void collectionOf(name).set(id, data),
    }),
  }),
  getAll: vi.fn(async (...refs: Ref[]) =>
    refs.map((ref) => snapshotOf(ref.collection, ref.id)),
  ),
  bulkWriter: () => ({
    set: (ref: Ref, data: Data) =>
      bulkWrite(ref, () => collectionOf(ref.collection).set(ref.id, data)),
    delete: (ref: Ref) =>
      bulkWrite(ref, () => collectionOf(ref.collection).delete(ref.id)),
    close: async () => {},
  }),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => fakeDb,
  FieldPath: { documentId: () => "__name__" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/handlers", () => ({
  readerAwareCachedEventHandler: (fn: unknown) => fn,
}));
vi.mock("../../../../server/utils/contracts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toContractRow: (snapshot: { id: string; data: () => Data }) => ({
    id: snapshot.id,
    valueSort: snapshot.data().value as number,
  }),
  // The join queries `nodes` with `in`, which this store does not run; what
  // it resolves is `contracts.test.ts`'s business.
  resolveNodeIds: vi.fn(async () => ({
    linked: 0,
    bothLinked: 0,
    unresolvedNips: [],
  })),
}));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn(async () => ({ uid: "pipeline" })),
  requireDatascience: vi.fn(),
}));
const { mockPurge } = vi.hoisted(() => ({ mockPurge: vi.fn(async () => 0) }));
vi.mock("../../../../server/utils/cache", () => ({
  purgeContractLinkCaches: mockPurge,
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  g.defineEventHandler = (fn: unknown) => fn;
  g.createError = (error: unknown) => error;
  g.getValidatedQuery = async (
    event: { query: unknown },
    parse: (query: unknown) => unknown,
  ) => {
    try {
      return parse(event.query);
    } catch {
      throw { statusCode: 400, statusMessage: "Validation Error" };
    }
  };
  g.readValidatedBody = async (
    event: { body: unknown },
    parse: (body: unknown) => unknown,
  ) => {
    try {
      return parse(event.body);
    } catch {
      throw { statusCode: 400, statusMessage: "Validation Error" };
    }
  };
  g.getRouterParam = (event: { params: Record<string, string> }, key: string) =>
    event.params[key];
});

const NOW = "2026-09-25T12:00:00.000Z";

/** The fixtures, plus findings that share a total - the case a cursor on the
 * total alone gets wrong - numbered on after them. */
function seed() {
  for (const collection of Object.values(store)) collection.clear();
  const docs: ContractLink[] = payloads.map((payload) =>
    toContractLinkDoc(contractLinkPayloadSchema.parse(payload), NOW),
  );
  const strengths: ContractLinkStrength[] = ["D", "C", "D", "D", "B", "D"];
  for (const [index, strength] of strengths.entries()) {
    const nip = String(9990001000 + index);
    docs.push({
      ...docs[4]!,
      nip,
      krs: [],
      company: `FIRMA ${index}`,
      strength,
      rank: docs.length + 1,
      visibility: index % 2 ? "public" : "gated",
      total: 15000,
    });
  }
  for (const doc of docs) {
    collectionOf("contractLinks").set(`cru_${doc.nip}`, doc as unknown as Data);
  }
  collectionOf("stats").set(
    "powiazania",
    computeContractLinkSummary(docs, NOW) as unknown as Data,
  );
  // Where the uploader puts them, as the seed does.
  for (const payload of contractPayloads) {
    const contract = toContractDoc(
      payload as Parameters<typeof toContractDoc>[0],
    );
    collectionOf(CONTRACT_LINK_CONTRACT_COLLECTION).set(
      contractIdOf(payload.id_umowy),
      contract as unknown as Data,
    );
  }
  return docs;
}

function contractIdOf(sourceId: string) {
  return `cru_${sourceId.replace(/-/g, "")}`;
}

let docs: ContractLink[] = [];
const gatedIds = () =>
  docs
    .filter((doc) => doc.visibility === "gated")
    .map((doc) => `cru_${doc.nip}`);

function list(query: Record<string, unknown>, hasUser = false) {
  return listHandler({
    query,
    context: { hasUser },
  } as never) as Promise<ContractLinkListResponse>;
}

function detail(id: string, hasUser = false) {
  return detailHandler({
    params: { id },
    context: { hasUser },
  } as never) as Promise<{ link: ContractLinkItem; contracts: unknown[] }>;
}

/** Every page of a listing, following `nextCursor`, with the raw responses. */
async function walk(query: Record<string, unknown>, hasUser = false) {
  const pages: ContractLinkListResponse[] = [];
  let cursor: string | undefined;
  do {
    const page = await list(
      { ...query, ...(cursor ? { cursor } : {}) },
      hasUser,
    );
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
    if (pages.length > 50) throw new Error("the cursor does not advance");
  } while (cursor);
  return { pages, items: pages.flatMap((page) => page.items) };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  docs = seed();
  failing.clear();
  mockPurge.mockClear();
  fakeDb.getAll.mockClear();
});

describe("GET /api/contracts/powiazania", () => {
  it("sends an anonymous reader no gated finding's NIP, cursor included", async () => {
    for (const sort of ["sila", "kwota"]) {
      for (const limit of [1, 2, 24]) {
        const { pages } = await walk({ sort, limit });
        for (const page of pages) {
          const wire = JSON.stringify(page);
          for (const id of gatedIds()) expect(wire).not.toContain(id);
          for (const nip of wire.match(/\d{10}/g) ?? []) {
            expect(gatedIds()).not.toContain(`cru_${nip}`);
          }
          if (page.nextCursor) expect(page.nextCursor).toMatch(/^\d+$/);
        }
      }
    }
  });

  it("pages through every finding exactly once, in the site's order", async () => {
    for (const hasUser of [false, true]) {
      const { items } = await walk({ sort: "sila", limit: 2 }, hasUser);
      expect(items.map((item) => item.rank)).toEqual(
        docs.map((doc) => doc.rank).sort((a, b) => a - b),
      );
    }
  });

  it("pages through every finding exactly once by money, ties in rank order", async () => {
    const expected = [...docs]
      .sort((a, b) => b.total - a.total || a.rank - b.rank)
      .map((doc) => doc.rank);
    // Seven findings on 15 000 zł: a page boundary has to fall among them.
    expect(docs.filter((doc) => doc.total === 15000).length).toBe(7);
    for (const limit of [1, 2, 3]) {
      for (const hasUser of [false, true]) {
        const { items } = await walk({ sort: "kwota", limit }, hasUser);
        expect(items.map((item) => item.rank)).toEqual(expected);
      }
    }
  });

  it("pages a filtered list exactly once as well", async () => {
    const { items } = await walk({ sort: "kwota", limit: 1, klasa: "D" });
    expect(items.map((item) => item.rank)).toEqual(
      docs
        .filter((doc) => doc.strength === "D")
        .sort((a, b) => b.total - a.total || a.rank - b.rank)
        .map((doc) => doc.rank),
    );
  });

  it("reads a malformed cursor as the first page, summary and all", async () => {
    const first = await list({ limit: 2 });
    for (const cursor of [
      "1|a/b",
      "1|__x__",
      "abc",
      "24|cru_9990000033",
      "0",
    ]) {
      expect(await list({ limit: 2, cursor })).toEqual(first);
    }
    expect(first.summary).not.toBeNull();
    expect(
      (await list({ limit: 2, cursor: first.nextCursor! })).summary,
    ).toBeNull();
  });

  it("narrows to one class", async () => {
    const { items } = await walk({ klasa: "D" });
    expect(items.length).toBe(
      docs.filter((doc) => doc.strength === "D").length,
    );
    expect(items.every((item) => item.strength === "D")).toBe(true);
    // Typed by hand in lower case, it means the same.
    expect((await walk({ klasa: "d" })).items).toEqual(items);
    await expect(list({ klasa: "E" })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("takes a województwo in any case", async () => {
    const lower = await list({ woj: "opolskie" });
    expect(lower.items.length).toBeGreaterThan(0);
    expect(await list({ woj: " Opolskie " })).toEqual(lower);
    expect(await list({ woj: "MAŁOPOLSKIE" })).toEqual(
      await list({ woj: "małopolskie" }),
    );
    // Blank reads as no filter at all.
    expect(await list({ woj: "" })).toEqual(await list({}));
  });
});

describe("GET /api/contracts/powiazania/<id>", () => {
  it("answers an anonymous gated cru_ id exactly as an id with no finding", async () => {
    const gated = await rejection(detail("cru_9990000033"));
    const missing = await rejection(detail("cru_1234567890"));
    expect(gated).toEqual(missing);
    expect(JSON.stringify(gated)).toBe(JSON.stringify(missing));
    expect(gated).toMatchObject({ statusCode: 404 });
  });

  it("sends a signed-in reader a gated finding in full", async () => {
    const { link } = await detail("cru_9990000033", true);
    expect(link).toMatchObject({ id: "cru_9990000033", locked: false });
  });

  it("sends an anonymous reader a public finding without its ties or the why that names them", async () => {
    const { link, contracts } = await detail("cru_9990000011");
    const wire = JSON.stringify(link);
    expect(link).toMatchObject({ locked: false, ties: [], hiddenTies: 1 });
    expect(wire).not.toContain("Anna Testowa");
    expect(wire).not.toContain("Testową");
    expect(contracts).toHaveLength(2);
  });

  it("resolves ukryte_<rank> to the full finding for a signed-in reader", async () => {
    const { link, contracts } = await detail("ukryte_2", true);
    expect(link).toMatchObject({
      id: "cru_9990000011",
      locked: false,
      rank: 2,
    });
    expect(JSON.stringify(link)).toContain("Anna Testowa");
    expect(contracts).toHaveLength(2);

    const gated = await detail("ukryte_1", true);
    expect(gated.link).toMatchObject({ id: "cru_9990000033", locked: false });
  });

  it("resolves ukryte_<rank> to the teaser for anybody else", async () => {
    const { link, contracts } = await detail("ukryte_1");
    expect(link).toMatchObject({ id: "ukryte_1", locked: true, rank: 1 });
    expect(contracts).toEqual([]);
    const wire = JSON.stringify(link);
    for (const secret of ["9990000033", "PRZYKŁAD", "Marek", "2400000"]) {
      expect(wire).not.toContain(secret);
    }
    // And the teaser is the one the list shows at that rank.
    const listed = (await list({ limit: 60 })).items.find(
      (item) => item.rank === 1,
    );
    expect(link).toEqual(listed);
  });

  it("resolves ukryte_<rank> of a public finding to the finding, stripped", async () => {
    const { link } = await detail("ukryte_2");
    expect(link).toMatchObject({
      id: "cru_9990000011",
      locked: false,
      ties: [],
    });
  });

  it("answers 404 for a rank with no finding, and 400 for anything else", async () => {
    expect(await rejection(detail("ukryte_999"))).toEqual(
      await rejection(detail("cru_1234567890")),
    );
    for (const id of ["cru_123", "ukryte_", "ukryte_1x", "9990000033"]) {
      expect(await rejection(detail(id))).toMatchObject({ statusCode: 400 });
    }
  });

  it("reads a finding's contracts from their closed collection, and a teaser none", async () => {
    expect(collectionOf("contracts").size).toBe(0);
    const { contracts } = await detail("cru_9990000011");
    expect(contracts).toEqual([
      {
        id: contractIdOf("a1b2c3d4-0008-4aaa-9bbb-000000000008"),
        valueSort: 850000,
      },
      {
        id: contractIdOf("a1b2c3d4-0009-4aaa-9bbb-000000000009"),
        valueSort: 120000,
      },
    ]);

    fakeDb.getAll.mockClear();
    await detail("ukryte_1");
    await rejection(detail("cru_9990000033"));
    expect(fakeDb.getAll).not.toHaveBeenCalled();
  });

  it("looks for a contract the closed collection lacks among the public ones", async () => {
    const id = contractIdOf("a1b2c3d4-0009-4aaa-9bbb-000000000009");
    const contract = collectionOf(CONTRACT_LINK_CONTRACT_COLLECTION).get(id)!;
    collectionOf(CONTRACT_LINK_CONTRACT_COLLECTION).delete(id);
    collectionOf("contracts").set(id, contract);

    const { contracts } = await detail("cru_9990000011");
    expect(contracts.map((row) => (row as { id: string }).id)).toContain(id);
    expect(contracts).toHaveLength(2);
  });

  it("sends the biggest contracts, not the first the research happened to list", async () => {
    // 150 contracts listed smallest first, the top one last - the order that
    // once lost it to a cut made before the sort.
    const ids = Array.from({ length: 150 }, (_, index) => `cru_big${index}`);
    for (const [index, id] of ids.entries()) {
      collectionOf(CONTRACT_LINK_CONTRACT_COLLECTION).set(id, {
        value: 1000 * (index + 1),
      });
    }
    const budtest = collectionOf("contractLinks").get("cru_9990000011")!;
    collectionOf("contractLinks").set("cru_9990000011", {
      ...budtest,
      contractIds: ids,
      topContract: { ...(budtest.topContract as Data), id: ids.at(-1) },
    });

    const { contracts } = await detail("cru_9990000011", true);
    const values = contracts.map(
      (row) => (row as { valueSort: number }).valueSort,
    );
    expect(values).toHaveLength(60);
    expect(values[0]).toBe(150000);
    expect(values.at(-1)).toBe(91000);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});

describe("POST /api/ingest/contracts/powiazania", () => {
  function ingest(body: unknown) {
    return ingestHandler({ body } as never) as Promise<{
      written: number;
      deleted: number;
    }>;
  }

  it("purges the cached list and page after every batch", async () => {
    await ingest({ links: [payloads[0]] });
    expect(mockPurge).toHaveBeenCalledOnce();
  });

  it("refuses a batch in which two findings share a rank", async () => {
    await expect(
      ingest({
        links: [payloads[0], { ...payloads[1], rank: payloads[0]!.rank }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("fails the run where two kept findings share a rank, after writing the summary", async () => {
    const clash = { ...payloads[1], rank: payloads[0]!.rank };
    const keep = docs.map((doc) => `cru_${doc.nip}`);
    const error = await rejection(ingest({ links: [clash], final: { keep } }));

    expect(error).toMatchObject({
      statusCode: 409,
      message: `Findings share a rank: ${payloads[0]!.rank}.`,
    });
    expect(collectionOf("stats").get("powiazania")).toMatchObject({
      links: docs.length,
    });
    expect(mockPurge).toHaveBeenCalledOnce();
  });

  it("prunes what the run did not keep and recounts the rest", async () => {
    const keep = payloads.map((payload) => `cru_${payload.nip}`);
    const result = await ingest({ links: [], final: { keep } });

    expect(result.deleted).toBe(docs.length - payloads.length);
    expect(collectionOf("stats").get("powiazania")).toMatchObject({
      links: payloads.length,
      gatedVerified: 1,
      // Three findings have somebody in office, and one of them may not be
      // the same person (`identity_unconfirmed`).
      inOfficePeople: 2,
    });
  });

  it("answers 500 over a finding it could not write, and prunes nothing", async () => {
    const before = collectionOf("contractLinks").size;
    const summary = collectionOf("stats").get("powiazania");
    failing.add(`cru_${payloads[1]!.nip}`);

    const error = await rejection(
      ingest({ links: payloads, final: { keep: [] } }),
    );

    expect(error).toMatchObject({ statusCode: 500 });
    expect(String((error as { message: string }).message)).toContain(
      "1 findings were not written",
    );
    expect(collectionOf("contractLinks").size).toBe(before);
    expect(collectionOf("stats").get("powiazania")).toBe(summary);
    // The rest of the batch was written, so the cached page goes all the same.
    expect(mockPurge).toHaveBeenCalledOnce();
  });

  it("answers 500 when a stale finding stays, and does not recount without it", async () => {
    const summary = collectionOf("stats").get("powiazania");
    const stale = `cru_${docs.at(-1)!.nip}`;
    failing.add(stale);
    const keep = payloads.map((payload) => `cru_${payload.nip}`);

    const error = await rejection(ingest({ links: [], final: { keep } }));

    expect(error).toMatchObject({ statusCode: 500 });
    expect(collectionOf("contractLinks").has(stale)).toBe(true);
    expect(collectionOf("stats").get("powiazania")).toBe(summary);
  });
});

describe("POST /api/ingest/contracts/powiazania/umowy", () => {
  function ingest(body: unknown) {
    return contractIngestHandler({ body } as never) as Promise<{
      written: number;
      deleted: number;
    }>;
  }
  const closed = () => collectionOf(CONTRACT_LINK_CONTRACT_COLLECTION);

  it("stores the contracts behind the findings apart from the public ones", async () => {
    closed().clear();
    const result = await ingest({ contracts: contractPayloads });

    expect(result).toMatchObject({ written: contractPayloads.length });
    expect([...closed().keys()].sort()).toEqual(
      contractPayloads.map((payload) => contractIdOf(payload.id_umowy)).sort(),
    );
    // Mapped as the public ingest maps them.
    expect(closed().get(contractIdOf(contractPayloads[0]!.id_umowy))).toEqual(
      toContractDoc(contractPayloads[0] as Parameters<typeof toContractDoc>[0]),
    );
    expect(collectionOf("contracts").size).toBe(0);
    // The anonymous detail of a public finding is cached with its contracts.
    expect(mockPurge).toHaveBeenCalledOnce();
  });

  it("keeps the contracts a run named, by the register's id, and deletes the rest", async () => {
    closed().set("cru_stale", { value: 1 });
    const keep = contractPayloads.map((payload) => payload.id_umowy);

    const result = await ingest({ final: { keep } });

    expect(result.deleted).toBe(1);
    expect(closed().has("cru_stale")).toBe(false);
    expect(closed().size).toBe(contractPayloads.length);
  });

  it("answers 500 over a contract it could not write, and prunes nothing", async () => {
    closed().clear();
    closed().set("cru_stale", { value: 1 });
    failing.add(contractIdOf(contractPayloads[0]!.id_umowy));

    const error = await rejection(
      ingest({ contracts: contractPayloads, final: { keep: [] } }),
    );

    expect(error).toMatchObject({ statusCode: 500 });
    expect(closed().has("cru_stale")).toBe(true);
    expect(closed().size).toBe(contractPayloads.length);
  });

  it("answers 500 over a stale contract it could not delete", async () => {
    closed().set("cru_stale", { value: 1 });
    failing.add("cru_stale");
    const keep = contractPayloads.map((payload) => payload.id_umowy);

    await expect(ingest({ final: { keep } })).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it("writes nothing for a caller outside the datascience group", async () => {
    closed().clear();
    vi.mocked(requireDatascience).mockImplementationOnce(() => {
      throw { statusCode: 403 };
    });

    await expect(ingest({ contracts: contractPayloads })).rejects.toMatchObject(
      { statusCode: 403 },
    );
    expect(closed().size).toBe(0);
  });
});

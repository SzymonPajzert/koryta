import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "../../../server/api/search/facts.get";
import { forgetFactNameIndex } from "../../../server/utils/factNames";
import { generateChunksLower } from "../../../shared/search";
import type { FactNameHit } from "../../../shared/factNames";

type Doc = { id: string; data: Record<string, unknown> };
type Filter = [field: string, op: string, value: unknown];

const { mockGetUser, headers, reads, collections } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  return {
    mockGetUser: vi.fn(),
    headers: new Map<string, string>(),
    /** Every query that reached "Firestore", with its filters and field
     * mask - what the tests hold the read cost to. */
    reads: [] as {
      collection: string;
      filters: Filter[];
      select: string[] | null;
    }[],
    collections: new Map<string, Doc[]>(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase-functions/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

/** Just enough of a query engine for the two filters the index uses. */
function matches(data: Record<string, unknown>, [field, op, value]: Filter) {
  if (op === "==") return data[field] === value;
  if (op === "array-contains-any") {
    const held = (data[field] as unknown[] | undefined) ?? [];
    return (value as unknown[]).some((wanted) => held.includes(wanted));
  }
  throw new Error(`unsupported operator ${op}`);
}

/** Set to make every query fail, as a Firestore outage would. */
let failReads = false;

function query(collection: string, filters: Filter[] = []) {
  let select: string[] | null = null;
  const builder = {
    where: (field: string, op: string, value: unknown) =>
      query(collection, [...filters, [field, op, value]]),
    select: (...fields: string[]) => {
      select = fields;
      return builder;
    },
    get: async () => {
      reads.push({ collection, filters, select });
      if (failReads) throw new Error("UNAVAILABLE");
      const docs = (collections.get(collection) ?? []).filter((doc) =>
        filters.every((filter) => matches(doc.data, filter)),
      );
      return {
        docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
      };
    },
  };
  return builder;
}

/** A collection that can also hand out document refs, for `getAll`. */
function collection(name: string) {
  return { ...query(name), doc: (id: string) => ({ collection: name, id }) };
}

/** `getAll` over refs, then its options (the field mask). Each page read is
 * logged like a query, with the ids it asked for as its "filter". */
async function getAll(...args: unknown[]) {
  const refs = args.filter(
    (arg): arg is { collection: string; id: string } =>
      !!arg && typeof (arg as { id?: unknown }).id === "string",
  );
  const options = args.find((arg) => !refs.includes(arg as never)) as
    { fieldMask?: string[] } | undefined;
  reads.push({
    collection: `getAll:${refs[0]?.collection ?? ""}`,
    filters: [["__id__", "in", refs.map((ref) => ref.id)]],
    select: options?.fieldMask ?? null,
  });
  return refs.map((ref) => {
    const doc = (collections.get(ref.collection) ?? []).find(
      (d) => d.id === ref.id,
    );
    return { id: ref.id, data: () => doc?.data };
  });
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection, getAll }),
}));

const search = async (q: string, extra: Record<string, unknown> = {}) =>
  (await (
    handler as unknown as (event: unknown) => Promise<{ names: FactNameHit[] }>
  )({ query: { q, ...extra } })) as { names: FactNameHit[] };

/** The report's own case: Piotr Ferster, on his half-brother's page. */
const FERSTER: Doc = {
  id: "ferster",
  data: {
    fact_type: "personal_relation",
    subject: "Rafał Trzaskowski",
    object: "Piotr Ferster",
    relation: "przyrodni brat",
    personNodeId: "trzaskowski",
    personNodeName: "Rafał Trzaskowski",
    personMatched: true,
    articleUrl: "rmf24.pl/wybory",
    articleDomain: "rmf24.pl",
    justification: "Przyrodnim bratem Trzaskowskiego jest Piotr Ferster",
  },
};

/** An article about somebody the graph does not have. */
const ZIOBRO: Doc = {
  id: "ziobro",
  data: {
    fact_type: "affair_involvement",
    person: "Zbigniew Ziobro",
    personMatched: false,
    articleUrl: "https://www.tvn24.pl/fundusz",
    articleDomain: "tvn24.pl",
    justification: "Zbigniew Ziobro kierował...",
  },
};

/** A fact that names only its own, matched subject. */
const MATCHED: Doc = {
  id: "matched",
  data: {
    fact_type: "employment",
    person: "Anna Nowak",
    personNodeId: "nowak",
    personNodeName: "Anna Nowak",
    personMatched: true,
    articleUrl: "example.com/a",
  },
};

const person = (id: string, name: string, extra = {}): Doc => ({
  id,
  data: {
    type: "person",
    name,
    nameChunksLower: generateChunksLower(name),
    ...extra,
  },
});

describe("GET /api/search/facts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetFactNameIndex();
    headers.clear();
    reads.length = 0;
    failReads = false;
    collections.clear();
    collections.set("extractions", [FERSTER, ZIOBRO, MATCHED]);
    collections.set("nodes", [person("trzaskowski", "Rafał Trzaskowski")]);
    mockGetUser.mockResolvedValue({ uid: "reader" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds the other person in a relation, and the page that names them", async () => {
    const { names } = await search("Piotr Ferster");

    expect(names).toEqual([
      {
        name: "Piotr Ferster",
        facts: 1,
        people: [{ id: "trzaskowski", name: "Rafał Trzaskowski", facts: 1 }],
        morePeople: 0,
        articles: [],
        moreArticles: 0,
      },
    ]);
  });

  it("finds the subject of a fact that matched nobody, on its article", async () => {
    const { names } = await search("ziobro");

    expect(names.map((hit) => hit.name)).toEqual(["Zbigniew Ziobro"]);
    expect(names[0]!.articles).toEqual([
      { url: "https://www.tvn24.pl/fundusz", domain: "tvn24.pl", facts: 1 },
    ]);
  });

  it("refuses a caller who is not signed in, before reading anything", async () => {
    // The facts are shown to signed in readers only, and a name with the page
    // it is mentioned on is most of what a fact says.
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
    );

    await expect(search("Piotr Ferster")).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(reads).toHaveLength(0);
  });

  it("keeps the answer out of every cache on the way", async () => {
    await search("Piotr Ferster");
    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reads only the facts that can name somebody without a page", async () => {
    await search("Piotr Ferster");

    const factReads = reads.filter((read) => read.collection === "extractions");
    expect(factReads.map((read) => read.filters)).toEqual([
      [["fact_type", "==", "personal_relation"]],
      [["personMatched", "==", false]],
    ]);
    // A field mask on both, so no justification crosses the wire.
    for (const read of factReads) {
      expect(read.select).not.toContain("justification");
      expect(read.select).toContain("object");
    }
  });

  it("reads the facts once, and answers every search after from memory", async () => {
    await search("Piotr Ferster");
    const afterFirst = reads.length;

    await search("ziobro");
    await search("pio fer");

    expect(reads).toHaveLength(afterFirst);
  });

  it("reads them again once an ingest has forgotten them", async () => {
    await search("Piotr Ferster");
    collections.get("extractions")!.push({
      id: "new",
      data: {
        ...FERSTER.data,
        object: "Andrzej Trzaskowski",
        relation: "ojciec",
      },
    });

    forgetFactNameIndex();
    const { names } = await search("andrzej trzaskowski");

    expect(names.map((hit) => hit.name)).toEqual(["Andrzej Trzaskowski"]);
  });

  it("serves the old index while it reads a new one past twelve hours", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    await search("Piotr Ferster");
    collections.get("extractions")!.push({
      id: "new",
      data: { ...FERSTER.data, object: "Andrzej Trzaskowski" },
    });

    now.mockReturnValue(start + 13 * 60 * 60 * 1000);
    // Answered from the old index, without waiting for the new one...
    expect((await search("andrzej trzaskowski")).names).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // ...which is what the next search gets.
    expect(
      (await search("andrzej trzaskowski")).names.map((hit) => hit.name),
    ).toEqual(["Andrzej Trzaskowski"]);
  });

  it("leaves out a name somebody has a page under", async () => {
    collections.get("nodes")!.push(person("ziobro-node", "Zbigniew Ziobro"));

    expect((await search("ziobro")).names).toEqual([]);
  });

  it("still offers a name whose only page was merged into another", async () => {
    collections
      .get("nodes")!
      .push(person("ziobro-node", "Zbigniew Ziobro", { deleted: true }));

    expect((await search("ziobro")).names.map((hit) => hit.name)).toEqual([
      "Zbigniew Ziobro",
    ]);
  });

  it("links the subject's page under the name it has now", async () => {
    // Renamed since the ingest: a link built from the stored name would go
    // through a slug redirect.
    collections.set("nodes", [
      person("trzaskowski", "Rafał Kazimierz Trzaskowski"),
    ]);

    const [ferster] = (await search("ferster")).names;
    expect(ferster!.people).toEqual([
      { id: "trzaskowski", name: "Rafał Kazimierz Trzaskowski", facts: 1 },
    ]);
  });

  it("sends a reader to the article when the subject's page is gone", async () => {
    for (const gone of [{ deleted: true }, { merged_into: "someone-else" }]) {
      forgetFactNameIndex();
      collections.set("nodes", [
        person("trzaskowski", "Rafał Trzaskowski", gone),
      ]);

      const [ferster] = (await search("ferster")).names;
      expect(ferster!.people).toEqual([]);
      expect(ferster!.articles).toEqual([
        { url: "rmf24.pl/wybory", domain: "rmf24.pl", facts: 1 },
      ]);
    }
  });

  it("reads each subject's page once, field-masked", async () => {
    await search("ferster");

    const pageReads = reads.filter(
      (read) => read.collection === "getAll:nodes",
    );
    expect(pageReads).toHaveLength(1);
    expect(pageReads[0]!.filters[0]![2]).toEqual(["trzaskowski"]);
    expect(pageReads[0]!.select).toEqual(
      expect.arrayContaining(["name", "deleted", "merged_into"]),
    );
  });

  it("does not read the facts again on every search after a failed build", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    failReads = true;
    await expect(search("ferster")).rejects.toThrow("UNAVAILABLE");
    const afterFailure = reads.length;

    // Ten minutes of searches answered with no names, and nothing read.
    failReads = false;
    now.mockReturnValue(start + 60_000);
    expect((await search("ferster")).names).toEqual([]);
    expect(reads).toHaveLength(afterFailure);

    // Then it tries again.
    now.mockReturnValue(start + 11 * 60_000);
    expect((await search("ferster")).names.map((hit) => hit.name)).toEqual([
      "Piotr Ferster",
    ]);
  });

  it("asks the graph about the names thirty at a time", async () => {
    collections.set(
      "extractions",
      Array.from({ length: 45 }, (_, i) => ({
        id: `f${i}`,
        data: {
          ...FERSTER.data,
          object: `Osoba ${String.fromCharCode(65 + (i % 26))}${"a".repeat(1 + Math.floor(i / 26))}`,
        },
      })),
    );

    await search("osoba");

    const nodeReads = reads.filter((read) => read.collection === "nodes");
    expect(nodeReads).toHaveLength(2);
    expect(
      nodeReads.map((read) => (read.filters[0]![2] as string[]).length),
    ).toEqual([30, 15]);
  });

  it("answers a single letter with nothing, and reads nothing for it", async () => {
    expect((await search("p")).names).toEqual([]);
    expect(reads).toHaveLength(0);
  });

  it("caps how many it answers", async () => {
    await expect(search("ferster", { limit: "50" })).rejects.toThrow();
  });
});

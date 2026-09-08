import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/missingReverse.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** What each scan asked for, so a test can say the endpoint kept going rather
 * than giving up on the first batch. */
const scans: { field: string; value: unknown; after: string | null }[] = [];

/** A query over `edges`, built the way the endpoint builds it: one equality
 * filter, ordered by document id, optionally starting after a cursor. Ordering
 * by id is the whole point of the cursor, so the fake sorts. */
function edgeQuery(field: string, value: unknown) {
  let after: string | null = null;
  let limit = Infinity;

  const query = {
    orderBy: vi.fn(() => query),
    startAfter: vi.fn((cursor: string) => {
      after = cursor;
      return query;
    }),
    limit: vi.fn((count: number) => {
      limit = count;
      return query;
    }),
    get: vi.fn(async () => {
      scans.push({ field, value, after });
      const matching = Object.entries(edges)
        .filter(([, data]) => data[field] === value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .filter(([id]) => (after === null ? true : id > after))
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: () => data }));
      return {
        docs: matching,
        size: matching.length,
        empty: matching.length === 0,
      };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      path: `${collection}/${id}`,
      parent: { id: collection },
    })),
    where: vi.fn((field: string, _op: string, value: unknown) =>
      edgeQuery(field, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldPath: { documentId: () => "__name__" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

function request(query: Record<string, unknown> = {}) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => parse(query),
  );
}

/** `id` padded so document ids sort the way the numbers do, which is what the
 * cursor relies on. */
function edgeId(index: number) {
  return `e${String(index).padStart(4, "0")}`;
}

function connection(extra: Record<string, unknown> = {}) {
  return {
    source: "jan",
    target: "anna",
    type: "connection",
    name: "żona",
    ...extra,
  };
}

type Result = {
  edges: {
    id: string;
    name: string;
    sourceName: string | null;
    targetName: string | null;
    published: boolean;
  }[];
  nextCursor: string | null;
  scanned: number;
  truncated: boolean;
};

const call = () => handler({} as never) as Promise<Result>;

describe("api/edges/missingReverse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scans.length = 0;
    nodes = {
      jan: { name: "Jan Kowalski", published: true },
      anna: { name: "Anna Kowalska", published: true },
    };
    edges = {};
    request();
  });

  it("lists a relation that names only one of its two sides", async () => {
    edges[edgeId(1)] = connection({ published: true });

    const result = await call();

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: edgeId(1),
      name: "żona",
      sourceName: "Jan Kowalski",
      targetName: "Anna Kowalska",
      published: true,
    });
  });

  it("only ever asks for connections", async () => {
    // The scan is the cost here, so it must not read the whole `edges`
    // collection: an employment has no second reading to be missing.
    edges[edgeId(1)] = connection();

    await call();

    expect(scans[0]).toMatchObject({ field: "type", value: "connection" });
  });

  it("leaves out a relation that already says both sides", async () => {
    edges[edgeId(1)] = connection({ reverse_name: "mąż" });

    expect((await call()).edges).toEqual([]);
  });

  it("leaves out a relation nobody named", async () => {
    // With no word at all it falls back to "Powiązanie z" on both pages, which
    // is already the same claim either way round.
    edges[edgeId(1)] = connection({ name: "" });
    edges[edgeId(2)] = connection({ name: undefined });

    expect((await call()).edges).toEqual([]);
  });

  it("skips deleted relations and ones missing an end", async () => {
    edges[edgeId(1)] = connection({ deleted: true });
    edges[edgeId(2)] = connection({ target: undefined });
    edges[edgeId(3)] = connection({ source: undefined });

    expect((await call()).edges).toEqual([]);
  });

  it("names an end whose page was never created as null rather than failing", async () => {
    edges[edgeId(1)] = connection({ target: "ghost" });

    const result = await call();

    expect(result.edges[0]).toMatchObject({
      sourceName: "Jan Kowalski",
      targetName: null,
    });
  });

  it("keeps scanning until the page is full", async () => {
    // The filter runs after the read, so a batch that happens to be entirely
    // complete relations would otherwise return an empty page while incomplete
    // ones sat just behind it.
    for (let i = 1; i <= 400; i += 1) {
      edges[edgeId(i)] = connection({ reverse_name: "mąż" });
    }
    edges[edgeId(350)] = connection();
    request({ limit: 1 });

    const result = await call();

    expect(result.edges.map((edge) => edge.id)).toEqual([edgeId(350)]);
    expect(scans.length).toBeGreaterThan(1);
  });

  it("resumes from the last relation it looked at, not the last it read", async () => {
    for (let i = 1; i <= 400; i += 1) edges[edgeId(i)] = connection();
    request({ limit: 2 });

    const result = await call();

    expect(result.edges.map((edge) => edge.id)).toEqual([edgeId(1), edgeId(2)]);
    expect(result.nextCursor).toBe(edgeId(2));
  });

  it("returns every incomplete relation across pages, losing none", async () => {
    for (let i = 1; i <= 5; i += 1) edges[edgeId(i)] = connection();
    request({ limit: 2 });

    const first = await call();
    request({ limit: 2, cursor: first.nextCursor ?? undefined });
    const second = await call();
    request({ limit: 2, cursor: second.nextCursor ?? undefined });
    const third = await call();

    expect(
      [...first.edges, ...second.edges, ...third.edges].map((e) => e.id),
    ).toEqual([edgeId(1), edgeId(2), edgeId(3), edgeId(4), edgeId(5)]);
  });

  it("says there is nothing more once the collection runs out", async () => {
    edges[edgeId(1)] = connection();

    const result = await call();

    expect(result.nextCursor).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("stops on its own budget and says so", async () => {
    // Firestore cannot ask for an absent field, so this is a scan; admitting
    // where it gave up beats a short page that reads as "nothing else left".
    for (let i = 1; i <= 4000; i += 1) {
      edges[edgeId(i)] = connection({ reverse_name: "mąż" });
    }

    const result = await call();

    expect(result.edges).toEqual([]);
    expect(result.scanned).toBe(3000);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import handlerModule from "../../../../server/api/nodes/index.get";

/** /api/nodes over a whole województwo, asked by its marker and paged by
 * Firestore, and over more companies than one array-contains-any takes, read
 * in chunks and kept so that the next page reads nothing. */
type Clause = { field: string; op: string; value: unknown };
type Data = Record<string, unknown>;

const { db, personQueries, regions, companies } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.setResponseHeader = (() => {}) as never;
  globalThis.getValidatedQuery = (async (
    event: { query: unknown },
    parser: (q: unknown) => unknown,
  ) => parser(event.query)) as never;

  const getPath = (data: unknown, path: string): unknown =>
    path
      .split(".")
      .reduce<unknown>((o, k) => (o as Data | undefined)?.[k], data);

  // 35 regions in województwo 14 and 35 companies: more than one query takes.
  const regions = Array.from(
    { length: 35 },
    (_, i) => `teryt14${String(i).padStart(2, "0")}`,
  );
  const companies = Array.from({ length: 35 }, (_, i) => `company${i}`);
  // As computeEdgeStats writes them: the regions, then their województwo.
  const withMarkers = (ids: string[]) =>
    ids.some((id) => id.startsWith("teryt14")) ? [...ids, "woj:14"] : ids;
  const person = (id: string, targets: string[], approved: boolean) => ({
    id,
    data: {
      type: "person",
      name: id,
      parties: [],
      stats: {
        isApproved: approved,
        votes: { interesting: id.length },
        edges: {
          all: { targetNodeIds: withMarkers(targets) },
          approved: { targetNodeIds: approved ? withMarkers(targets) : [] },
        },
      },
    },
  });
  const docs: { id: string; data: Data }[] = [
    ...regions.map((id) => ({
      id,
      data: { type: "region", teryt: id.slice(5), name: id },
    })),
    person("anna", [regions[0]!, companies[0]!], true),
    person("bartosz", [regions[34]!, companies[34]!], true),
    person("celina", [regions[3]!, regions[33]!, companies[3]!], true),
    person("draft", [regions[1]!, companies[1]!], false),
    person("elsewhere", ["teryt0201"], true),
  ];

  const personQueries: Clause[][] = [];
  function query(clauses: Clause[], order?: [string, string]): unknown {
    const matching = () => {
      const rows = docs.filter((doc) =>
        clauses.every((c) => {
          const value = getPath(doc.data, c.field);
          if (c.op === "==") return value === c.value;
          if (c.op === "array-contains-any") {
            return (
              Array.isArray(value) &&
              value.some((v) => (c.value as unknown[]).includes(v))
            );
          }
          throw new Error(`the fake does not know ${c.op}`);
        }),
      );
      if (order) {
        const [field, dir] = order;
        rows.sort((a, b) => {
          const r =
            (getPath(a.data, field) as number) -
            (getPath(b.data, field) as number);
          return dir === "desc" ? -r : r;
        });
      }
      return rows;
    };
    let skip = 0;
    let take = Infinity;
    const q = {
      where: (field: string, op: string, value: unknown) =>
        query([...clauses, { field, op, value }], order),
      orderBy: (field: string, dir: string) => query(clauses, [field, dir]),
      offset: (n: number) => ((skip = n), q),
      limit: (n: number) => ((take = n), q),
      select: () => q,
      doc: (id: string) => ({ id }),
      count: () => ({
        get: async () => ({ data: () => ({ count: matching().length }) }),
      }),
      get: async () => {
        if (clauses.some((c) => c.value === "person"))
          personQueries.push(clauses);
        return {
          docs: matching()
            .slice(skip, skip + take)
            .map((doc) => ({
              id: doc.id,
              data: () => structuredClone(doc.data),
            })),
        };
      },
    };
    return q;
  }
  return {
    db: {
      collection: () => query([]),
      getAll: async (...refs: unknown[]) =>
        refs
          .filter((ref): ref is { id: string } =>
            Boolean((ref as { id?: string } | null)?.id),
          )
          .map((ref) => ({ id: ref.id, data: () => undefined })),
    },
    personQueries,
    regions,
    companies,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => db,
  FieldPath: { documentId: () => "__name__" },
  Filter: { where: vi.fn(), or: vi.fn() },
}));
vi.mock("firebase-functions/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization ? { uid: "editor" } : null,
  getUser: async (event: { headers?: Record<string, string> }) => {
    if (!event.headers?.authorization) throw { statusCode: 401 };
    return { uid: "editor" };
  },
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
}));

type Listed = {
  nodes: Record<string, { id: string }>;
  total: number;
  matched?: Record<string, string[]>;
};

async function list(query: Record<string, string>, signedIn = false) {
  // @ts-expect-error the default export may already be the handler
  const handler = handlerModule.default || handlerModule;
  return (await handler({
    query,
    headers: signedIn ? { authorization: "Bearer token" } : {},
    context: {},
  })) as Listed;
}

describe("GET /api/nodes for a whole województwo", () => {
  it("asks for its marker and lets Firestore page and count", async () => {
    personQueries.length = 0;
    const first = await list({
      type: "person",
      teryt: "14",
      limit: "2",
      page: "1",
    });

    expect(Object.keys(first.nodes)).toEqual(["anna", "bartosz"]);
    expect(first.total).toBe(3);
    // The row names its region, not the marker.
    expect(first.matched).toEqual({
      anna: [regions[0]],
      bartosz: [regions[34]],
    });
    expect(personQueries).toEqual([
      [
        { field: "type", op: "==", value: "person" },
        {
          field: "stats.edges.approved.targetNodeIds",
          op: "array-contains-any",
          value: ["woj:14"],
        },
        { field: "stats.isApproved", op: "==", value: true },
      ],
    ]);

    const second = await list({
      type: "person",
      teryt: "14",
      limit: "2",
      page: "2",
    });
    expect(Object.keys(second.nodes)).toEqual(["celina"]);
    expect(second.total).toBe(3);
  });

  it("finds a signed-in reader's drafts by the marker too", async () => {
    const listed = await list(
      { type: "person", teryt: "14", limit: "10", page: "1" },
      true,
    );
    expect(Object.keys(listed.nodes).sort()).toEqual([
      "anna",
      "bartosz",
      "celina",
      "draft",
    ]);
  });
});

describe("GET /api/nodes for more companies than one query takes", () => {
  it("reads the people tied to them in chunks, and the next page from memory", async () => {
    personQueries.length = 0;
    const place = companies;
    const first = await list({
      type: "person",
      place,
      limit: "2",
      page: "1",
    } as never);

    expect(Object.keys(first.nodes)).toEqual(["anna", "bartosz"]);
    expect(first.total).toBe(3);
    // Two chunks of at most thirty companies, published people only.
    expect(personQueries).toHaveLength(2);
    for (const clauses of personQueries) {
      expect(clauses).toContainEqual({
        field: "stats.isApproved",
        op: "==",
        value: true,
      });
      const chunk = clauses.find((c) => c.op === "array-contains-any")!;
      expect((chunk.value as string[]).length).toBeLessThanOrEqual(30);
    }

    const second = await list({
      type: "person",
      place,
      limit: "2",
      page: "2",
    } as never);
    expect(Object.keys(second.nodes)).toEqual(["celina"]);
    expect(personQueries).toHaveLength(2);

    // Another order of the same list is still the same list.
    const sorted = await list({
      type: "person",
      place,
      limit: "2",
      page: "1",
      sortBy: "votes.interesting",
      sortDesc: "true",
    } as never);
    expect(Object.keys(sorted.nodes)).toEqual(["bartosz", "celina"]);
    expect(personQueries).toHaveLength(2);
  });

  it("reads afresh for a signed-in reader", async () => {
    personQueries.length = 0;
    await list(
      { type: "person", place: companies, limit: "10" } as never,
      true,
    );
    await list(
      { type: "person", place: companies, limit: "10" } as never,
      true,
    );
    expect(personQueries).toHaveLength(4);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/successions.get";
import type {
  CompanySuccessions,
  PersonSuccessions,
} from "../../../../server/api/edges/successions.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** A query over `edges` built the way the endpoint builds it: equality filters
 * and one `in`, with no ordering - the pairing sorts its own results, so the
 * fake does not have to model an index. */
function edgeQuery() {
  const filters: [string, string, unknown][] = [];

  const query = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      filters.push([field, op, value]);
      return query;
    }),
    limit: vi.fn(() => query),
    get: vi.fn(async () => {
      const docs = Object.entries(edges)
        .filter(([, data]) =>
          filters.every(([field, op, value]) =>
            op === "in"
              ? (value as unknown[]).includes(data[field])
              : data[field] === value,
          ),
        )
        .map(([id, data]) => ({ id, data: () => data }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({ id, path: `${collection}/${id}` })),
    where: vi.fn((field: string, op: string, value: unknown) =>
      edgeQuery().where(field, op, value),
    ),
  })),
  getAll: vi.fn(async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => false,
}));

const { mockGetQuery } = vi.hoisted(() => {
  const mockGetQuery = vi.fn(() => ({}) as Record<string, unknown>);
  globalThis.getQuery = mockGetQuery as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetQuery };
});

function call<T>(query: Record<string, unknown>): Promise<T> {
  mockGetQuery.mockReturnValue(query);
  return handler({} as never) as Promise<T>;
}

/** One supervisory spell at the hospital. Every stored one says "Rada
 * Nadzorcza", whatever the institution's organ is really called. */
function seat(fields: Record<string, unknown>) {
  return {
    source: "anna",
    target: "szpital",
    type: "employed",
    name: "Rada Nadzorcza",
    published: true,
    ...fields,
  };
}

describe("api/edges/successions supervisory seats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodes = {
      anna: { name: "Anna Nowak", type: "person", published: true },
      jan: { name: "Jan Kowalski", type: "person", published: true },
      szpital: {
        name: "Szpital w Gnieźnie",
        type: "place",
        published: true,
        supervisoryBody: "rada-spoleczna",
      },
      orlen: { name: "Orlen", type: "place", published: true },
    };
    edges = {
      e1: seat({
        source: "jan",
        start_date: "2018-01-01",
        end_date: "2021-01-01",
      }),
      e2: seat({ source: "anna", start_date: "2021-01-01", end_date: null }),
    };
  });

  it("names the hospital's own organ on the handover", async () => {
    const { successions, current } = await call<CompanySuccessions>({
      companyId: "szpital",
    });

    expect(successions).toHaveLength(1);
    expect(successions[0]?.role).toBe("Rada Społeczna");
    expect(current.map((post) => post.role)).toEqual(["Rada Społeczna"]);
  });

  it("names it the same way from the person's side", async () => {
    const { posts } = await call<PersonSuccessions>({ personId: "anna" });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.role).toBe("Rada Społeczna");
  });

  it("leaves a spółka's board alone", async () => {
    edges = {
      e1: seat({
        source: "jan",
        target: "orlen",
        start_date: "2018-01-01",
        end_date: "2021-01-01",
      }),
      e2: seat({ target: "orlen", start_date: "2021-01-01", end_date: null }),
    };

    const { successions } = await call<CompanySuccessions>({
      companyId: "orlen",
    });

    expect(successions[0]?.role).toBe("Rada Nadzorcza");
  });

  it("keeps a role nobody recorded absent rather than empty", async () => {
    // `current` types the field as nullable and the card has its own wording
    // for it; `displayRole` returns undefined for a blank, so this is the one
    // place the coercion back to null matters.
    edges = {
      e2: seat({ name: "", start_date: "2021-01-01", end_date: null }),
    };

    const { current } = await call<CompanySuccessions>({
      companyId: "szpital",
    });

    expect(current[0]?.role).toBeNull();
  });
});

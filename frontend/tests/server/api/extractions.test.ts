import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/extractions/index.get";

const { mockCollection, extractionsQuery, votesQuery } = vi.hoisted(() => {
  globalThis.getValidatedQuery = async (event: any, parser: any) =>
    parser(event.query ?? {});

  // A chainable query recorder: every builder call is logged so the tests can
  // assert on ordering/limits without a Firestore instance.
  const makeQuery = () => {
    const calls: Array<[string, unknown[]]> = [];
    const query: any = { calls, docs: [] };
    for (const method of ["where", "orderBy", "offset", "limit"]) {
      query[method] = vi.fn((...args: unknown[]) => {
        calls.push([method, args]);
        return query;
      });
    }
    query.get = vi.fn(async () => ({ docs: query.docs }));
    return query;
  };

  const extractionsQuery = makeQuery();
  const votesQuery = makeQuery();
  const mockCollection = vi.fn((name: string) =>
    name === "votes" ? votesQuery : extractionsQuery,
  );

  return { mockCollection, extractionsQuery, votesQuery };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mockCollection }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// Unwrap the Nitro cache layer so the handler can be called directly.
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: any) => fn,
}));

function factDoc(id: string, createdAt: unknown, data: object = {}) {
  return {
    id,
    data: () => ({
      url: "https://example.com/a",
      articleUrl: "https://example.com/a",
      justification: "bo tak",
      fact_type: "employment",
      tag: "v1",
      createdAt,
      ...data,
    }),
  };
}

function timestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

describe("GET /api/extractions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractionsQuery.calls.length = 0;
    votesQuery.calls.length = 0;
    extractionsQuery.docs = [];
    votesQuery.docs = [];
  });

  it("orders by createdAt descending", async () => {
    await handler({ query: {} } as any);
    expect(extractionsQuery.calls).toContainEqual([
      "orderBy",
      ["createdAt", "desc"],
    ]);
  });

  it("applies no limit by default, so the whole backlog is returned", async () => {
    extractionsQuery.docs = Array.from({ length: 250 }, (_, i) =>
      factDoc(`f${i}`, timestamp("2026-07-27T10:00:00.000Z")),
    );

    const result = (await handler({ query: {} } as any)) as {
      facts: unknown[];
    };

    expect(extractionsQuery.limit).not.toHaveBeenCalled();
    expect(extractionsQuery.offset).not.toHaveBeenCalled();
    expect(result.facts).toHaveLength(250);
  });

  it("paginates only when an explicit limit is given", async () => {
    await handler({ query: { limit: "50", page: "2" } } as any);
    expect(extractionsQuery.offset).toHaveBeenCalledWith(100);
    expect(extractionsQuery.limit).toHaveBeenCalledWith(50);
  });

  it("serialises createdAt as an ISO string", async () => {
    extractionsQuery.docs = [
      factDoc("f1", timestamp("2026-07-27T10:00:00.000Z")),
    ];

    const result = (await handler({ query: {} } as any)) as {
      facts: Array<{ createdAt?: string }>;
    };

    expect(result.facts[0]!.createdAt).toBe("2026-07-27T10:00:00.000Z");
  });

  it("reads the review state off the document, never touching votes", async () => {
    extractionsQuery.docs = [
      factDoc("reviewed", timestamp("2026-07-27T10:00:00.000Z"), {
        stats: { votes: { humanVoted: true, correct: 1 } },
      }),
      factDoc("seeded", timestamp("2026-07-27T09:00:00.000Z"), {
        stats: { votes: { humanVoted: false } },
      }),
      // Pre-backfill document: no aggregate at all.
      factDoc("unseeded", timestamp("2026-07-27T08:00:00.000Z")),
    ];

    const result = (await handler({ query: {} } as any)) as {
      facts: Array<{ id?: string; reviewed?: boolean }>;
    };

    const byId = (id: string) => result.facts.find((f) => f.id === id)!;
    expect(byId("reviewed").reviewed).toBe(true);
    expect(byId("seeded").reviewed).toBe(false);
    expect(byId("unseeded").reviewed).toBe(false);
    // The onVoteWritten trigger already maintains the aggregate, so serving a
    // page of facts must not read the votes collection at all.
    expect(mockCollection).not.toHaveBeenCalledWith("votes");
    expect(votesQuery.get).not.toHaveBeenCalled();
  });
});

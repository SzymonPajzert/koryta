import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/extractions/index.get";

const { mockCollection, extractionsQuery, votesQuery } = vi.hoisted(() => {
  globalThis.getValidatedQuery = async (event: any, parser: any) =>
    parser(event.query ?? {});

  // A chainable query recorder: every builder call is logged so the tests can
  // assert on ordering/limits without a Firestore instance.
  const makeQuery = () => {
    const calls: Array<[string, unknown[]]> = [];
    const query: any = { calls, docs: [], total: 0 };
    for (const method of ["where", "orderBy", "offset", "limit"]) {
      query[method] = vi.fn((...args: unknown[]) => {
        calls.push([method, args]);
        return query;
      });
    }
    query.get = vi.fn(async () => ({ docs: query.docs }));
    // The count aggregation is a separate terminal call on the same builder.
    query.count = vi.fn(() => ({
      get: async () => ({ data: () => ({ count: query.total }) }),
    }));
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
    extractionsQuery.total = 0;
    votesQuery.total = 0;
  });

  it("orders by createdAt descending", async () => {
    await handler({ query: {} } as any);
    expect(extractionsQuery.calls).toContainEqual([
      "orderBy",
      ["createdAt", "desc"],
    ]);
  });

  it("serves a page by default, so the backlog is never returned whole", async () => {
    await handler({ query: {} } as any);
    expect(extractionsQuery.limit).toHaveBeenCalledWith(100);
    expect(extractionsQuery.offset).toHaveBeenCalledWith(0);
  });

  it("paginates by the requested limit", async () => {
    await handler({ query: { limit: "50", page: "2" } } as any);
    expect(extractionsQuery.offset).toHaveBeenCalledWith(100);
    expect(extractionsQuery.limit).toHaveBeenCalledWith(50);
  });

  it("rejects a limit above the cap rather than serving it", async () => {
    await expect(
      handler({ query: { limit: "5000" } } as any),
    ).rejects.toThrow();
  });

  it("counts the whole filtered query, not the page", async () => {
    extractionsQuery.docs = [
      factDoc("f1", timestamp("2026-07-27T10:00:00.000Z")),
    ];
    extractionsQuery.total = 742;

    const result = (await handler({ query: { limit: "1" } } as any)) as {
      facts: unknown[];
      total: number;
    };

    expect(result.facts).toHaveLength(1);
    expect(result.total).toBe(742);
  });

  it("filters on the vote aggregate when asked for unreviewed facts", async () => {
    await handler({ query: { reviewed: "no" } } as any);
    expect(extractionsQuery.calls).toContainEqual([
      "where",
      ["stats.votes.humanVoted", "==", false],
    ]);
  });

  it("does not filter on the vote aggregate by default", async () => {
    await handler({ query: {} } as any);
    expect(extractionsQuery.where).not.toHaveBeenCalled();
  });

  it("narrows to one article, so a capture can link to what it produced", async () => {
    // Matched exactly rather than normalised: `/api/ingest/page` and the
    // extractor derive this from the same `parseCrawlUrl` output, so an
    // equality is enough — and is what the composite index can serve.
    await handler({
      query: { articleUrl: "https://www.example.pl/artykuł" },
    } as any);

    expect(extractionsQuery.calls).toContainEqual([
      "where",
      ["articleUrl", "==", "https://www.example.pl/artykuł"],
    ]);
    // Still newest-first and still paged; the filter is an addition, not a
    // different query.
    expect(extractionsQuery.calls).toContainEqual([
      "orderBy",
      ["createdAt", "desc"],
    ]);
  });

  it("does not filter by article unless asked", async () => {
    await handler({ query: { reviewed: "no" } } as any);
    expect(extractionsQuery.where).not.toHaveBeenCalledWith(
      "articleUrl",
      "==",
      expect.anything(),
    );
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

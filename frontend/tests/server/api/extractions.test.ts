import { describe, it, expect, vi, beforeEach } from "vitest";
import rawHandler from "../../../server/api/extractions/index.get";

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
  readerAwareCachedEventHandler: (fn: any) => fn,
}));

// The wrapper resolves the reader and leaves the answer on the event; called
// directly there is nobody to do that. Every test below the gate's own speaks
// for a signed-in one, which is what the route used to serve everybody.
const handler = (event: any) =>
  (rawHandler as any)({ context: { hasUser: true }, ...event });

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

  it("narrows to one person by node id, which is what a person's page asks for", async () => {
    // An id equality, not a name match: `/api/ingest/extraction` resolves the
    // person once, against the graph, and writes `personNodeId` alongside
    // `personNodeName`. Filtering on the name here would hand a person's page
    // their namesake's facts — the very mistake the card's "To nie ta osoba"
    // flag exists to report.
    await handler({
      query: { personNodeId: "8DJ3NbeAtnJ8PStVtzFk" },
    } as any);

    expect(extractionsQuery.calls).toContainEqual([
      "where",
      ["personNodeId", "==", "8DJ3NbeAtnJ8PStVtzFk"],
    ]);
    // Still newest-first, which is the half of the query the composite index
    // (personNodeId ASC, createdAt DESC) has to be deployed for.
    expect(extractionsQuery.calls).toContainEqual([
      "orderBy",
      ["createdAt", "desc"],
    ]);
  });

  it("counts without reading the documents when asked for a count", async () => {
    // What a logged out person page gets: how many facts are behind the login
    // and none of their text. Blurring fetched text in CSS would leave the
    // sentences in the html of a named person's canonical url.
    extractionsQuery.docs = [
      factDoc("f1", timestamp("2026-07-27T10:00:00.000Z")),
    ];
    extractionsQuery.total = 7;

    const result = (await handler({
      query: { personNodeId: "abc123", countOnly: "true" },
    } as any)) as { facts: unknown[]; total: number };

    expect(result).toEqual({ facts: [], total: 7 });
    expect(extractionsQuery.get).not.toHaveBeenCalled();
    // Still narrowed to the one person, or the number would be meaningless.
    expect(extractionsQuery.calls).toContainEqual([
      "where",
      ["personNodeId", "==", "abc123"],
    ]);
  });

  it("does not filter by person unless asked", async () => {
    await handler({ query: { reviewed: "no" } } as any);
    expect(extractionsQuery.where).not.toHaveBeenCalledWith(
      "personNodeId",
      "==",
      expect.anything(),
    );
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
  // A logged out caller gets the count and never the sentences. The endpoint
  // said so in a comment for months while serving them anyway - `countOnly` is
  // a query flag, and a crawler has no reason to set it.
  describe("a caller with no user", () => {
    it("is answered with the count and no facts, whatever it asked for", async () => {
      extractionsQuery.docs = [
        factDoc("f1", timestamp("2026-07-27T10:00:00.000Z")),
      ];
      extractionsQuery.total = 742;

      const result = (await (rawHandler as any)({
        query: { personNodeId: "p1" },
        context: { hasUser: false },
      })) as { facts: unknown[]; total: number };

      expect(result.facts).toEqual([]);
      expect(result.total).toBe(742);
    });

    it("never reads the documents it would have to redact", async () => {
      await (rawHandler as any)({
        query: {},
        context: { hasUser: false },
      });
      expect(extractionsQuery.offset).not.toHaveBeenCalled();
      expect(extractionsQuery.limit).not.toHaveBeenCalled();
    });

    it("cannot reach the grouped-by-article shape either", async () => {
      extractionsQuery.docs = [
        factDoc("f1", timestamp("2026-07-27T10:00:00.000Z")),
      ];

      const result = (await (rawHandler as any)({
        query: { groupBy: "article" },
        context: { hasUser: false },
      })) as { facts?: unknown[]; articles?: object };

      expect(result.articles).toBeUndefined();
      expect(result.facts).toEqual([]);
    });

    it("is what a context nobody resolved a reader onto means", async () => {
      // Only `readerAwareCachedEventHandler` sets `hasUser`. If the route is
      // ever mounted behind a wrapper that does not, it has to fail closed
      // rather than read the absence as "signed in".
      const result = (await (rawHandler as any)({
        query: {},
        context: {},
      })) as { facts: unknown[] };
      expect(result.facts).toEqual([]);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/extraction.post";

const { mockReadBody, mockBatchSet, mockCommit, mockCollection, nodesQuery } =
  vi.hoisted(() => {
    const mockReadBody = vi.fn();
    globalThis.createError = (err: any) => err;
    globalThis.defineEventHandler = (fn: any) => fn;
    globalThis.readValidatedBody = async (_event: any, parse: any) =>
      parse(await mockReadBody());

    const mockBatchSet = vi.fn();
    const mockCommit = vi.fn().mockResolvedValue(undefined);

    // Article-node lookup: no existing nodes match.
    const nodesQuery: any = {
      where: vi.fn(() => nodesQuery),
      select: vi.fn(() => nodesQuery),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    };
    const mockCollection = vi.fn(() => ({
      where: nodesQuery.where,
      doc: vi.fn(() => ({ id: "new-extraction-id" })),
    }));

    return {
      mockReadBody,
      mockBatchSet,
      mockCommit,
      mockCollection,
      nodesQuery,
    };
  });

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: mockCollection,
    batch: () => ({ set: mockBatchSet, commit: mockCommit }),
  }),
  Timestamp: { now: () => "TS" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// `requireDatascience` is left real; only the token lookup is faked.
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: vi
    .fn()
    .mockResolvedValue({ uid: "test-user-id", datascience: true }),
}));

describe("api/ingest/extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodesQuery.get.mockResolvedValue({ docs: [] });
  });

  it("seeds stats.votes so unvoted facts stay queryable", async () => {
    mockReadBody.mockResolvedValue({
      articles: [
        {
          url: "https://example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "v1",
          extracted_facts: [
            {
              url: "https://example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toEqual({ status: "ok", count: 1 });
    // Firestore cannot query for an absent field, so an unreviewed fact has to
    // carry humanVoted: false to be findable by the review flow.
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stats: { votes: { humanVoted: false } } }),
    );
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it("links a fact to its article node across url spellings", async () => {
    // The pipeline sends no scheme; the crawler stored https and a www. Exact
    // string matching found nothing, which is why no extraction in production
    // carries an articleNodeId.
    nodesQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: "article-node",
          data: () => ({ sourceURL: "https://www.example.com/a/" }),
        },
      ],
    });
    mockReadBody.mockResolvedValue({
      articles: [
        {
          url: "example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "v1",
          extracted_facts: [
            {
              url: "example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    await handler({} as any);

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ articleNodeId: "article-node" }),
    );
  });

  it("credits the capture's uploader rather than the calling service", async () => {
    // The capture extractor holds its own datascience account and submits on
    // behalf of whoever captured the page; without this every fact found that
    // way would be attributed to the service.
    mockReadBody.mockResolvedValue({
      uploaderUid: "reader-who-captured-it",
      articles: [
        {
          url: "https://example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "capture_v1",
          extracted_facts: [
            {
              url: "https://example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    await handler({} as any);

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uploaderUid: "reader-who-captured-it" }),
    );
  });
});

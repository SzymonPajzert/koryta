import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";
import handler from "../../../../server/api/ingest/page.post";

const {
  mockReadBody,
  mockSave,
  mockCommit,
  mockBatchSet,
  mockUpdate,
  duplicateQuery,
  ensureArticleNode,
  dispatchExtraction,
  pageDoc,
  verifyIdToken,
} = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.createError = (error: any) =>
    Object.assign(new Error(error.message), error);
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.readValidatedBody = async (_event: any, parse: any) =>
    parse(await mockReadBody());
  globalThis.getRequestHeader = () => "Bearer token-under-test";

  const mockSave = vi.fn().mockResolvedValue(undefined);
  const mockCommit = vi.fn().mockResolvedValue(undefined);
  const mockBatchSet = vi.fn();
  const mockUpdate = vi.fn().mockResolvedValue(undefined);
  const duplicateQuery: any = {
    where: vi.fn(() => duplicateQuery),
    limit: vi.fn(() => duplicateQuery),
    get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  };
  const pageDoc = { id: "page-1", update: mockUpdate };

  return {
    mockReadBody,
    mockSave,
    mockCommit,
    mockBatchSet,
    mockUpdate,
    duplicateQuery,
    ensureArticleNode: vi.fn(),
    dispatchExtraction: vi.fn(),
    pageDoc,
    verifyIdToken: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => {
      if (name === "articlePages") {
        return { ...duplicateQuery, doc: () => pageDoc };
      }
      return duplicateQuery;
    },
    batch: () => ({ set: mockBatchSet, commit: mockCommit }),
  }),
  Timestamp: { now: () => "TS" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: (name: string) => {
      expect(name).toBe("koryta-pl-crawled");
      return { file: () => ({ save: mockSave }) };
    },
  }),
}));
vi.mock("../../../../server/utils/articles", () => ({ ensureArticleNode }));
vi.mock("../../../../server/utils/extractor", () => ({ dispatchExtraction }));
// server/utils/auth is left entirely real, so the 403 below is the actual
// `requireDatascience` gate rather than a restatement of it. Only the thing
// underneath it is faked: what Firebase says the bearer token decodes to.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: verifyIdToken }),
}));

const HTML =
  "<html><head><title>Artykuł</title></head><body>treść</body></html>";

function body(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://www.example.pl/artykul",
    html: gzipSync(Buffer.from(HTML, "utf8")).toString("base64"),
    htmlEncoding: "gzip-base64",
    title: "Artykuł",
    source: "extension",
    ...overrides,
  };
}

describe("api/ingest/page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdToken.mockResolvedValue({ uid: "kasia", datascience: true });
    mockReadBody.mockResolvedValue(body());
    duplicateQuery.get.mockResolvedValue({ empty: true, docs: [] });
    ensureArticleNode.mockResolvedValue({ nodeId: "node-1", created: true });
    dispatchExtraction.mockResolvedValue({ dispatched: true });
  });

  it("files the page where the crawler would have put it", async () => {
    const result = await handler({} as never);

    expect(result.status).toBe("ok");
    expect(result.storagePath).toMatch(
      /^gs:\/\/koryta-pl-crawled\/hostname=www\.example\.pl\/date=\d{4}-\d{2}-\d{2}\/uid_.+\.tar\.gz$/,
    );
    // A gzipped tar, not the raw html: the batch parser opens these with
    // tarfile and would find nothing in a bare document.
    const [archive, options] = mockSave.mock.calls[0]!;
    expect(options.contentType).toBe("application/gzip");
    expect(archive.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  });

  it("records the job against the article node", async () => {
    const result = await handler({} as never);

    expect(result.articleNodeId).toBe("node-1");
    const [, doc] = mockBatchSet.mock.calls.at(-1)!;
    expect(doc).toMatchObject({
      url: "https://www.example.pl/artykul",
      // Joined to article nodes and to extracted facts on this, not on `url`.
      normalizedUrl: "example.pl/artykul",
      domain: "www.example.pl",
      status: "stored",
      capturedBy: "kasia",
      source: "extension",
      htmlBytes: Buffer.byteLength(HTML),
    });
    expect(mockCommit).toHaveBeenCalled();
    expect(dispatchExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "page-1", uploaderUid: "kasia" }),
    );
  });

  it("accepts html that was not compressed", async () => {
    mockReadBody.mockResolvedValue(
      body({
        html: Buffer.from(HTML, "utf8").toString("base64"),
        htmlEncoding: "base64",
        source: "paste",
      }),
    );

    const result = await handler({} as never);

    expect(result.status).toBe("ok");
    expect(mockBatchSet.mock.calls.at(-1)![1]).toMatchObject({
      source: "paste",
      htmlBytes: Buffer.byteLength(HTML),
    });
  });

  it("returns the existing job when the same bytes arrive twice", async () => {
    // The popup retries, and a reload mid-upload sends the page again; neither
    // should cost a second extraction.
    duplicateQuery.get.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "page-existing",
          data: () => ({
            status: "done",
            articleNodeId: "node-9",
            storagePath: "gs://koryta-pl-crawled/old.tar.gz",
          }),
        },
      ],
    });

    const result = await handler({} as never);

    expect(result).toMatchObject({ pageId: "page-existing", duplicate: true });
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(dispatchExtraction).not.toHaveBeenCalled();
  });

  describe("a passage the reader picked out", () => {
    // Long enough to clear MIN_CAPTURE_SELECTION_CHARS, which is what stops a
    // double-clicked headline being sent as a paragraph.
    const PASSAGE =
      "Prezesem spółki został Jan Kowalski, który wcześniej kierował " +
      "departamentem w ministerstwie.";

    it("is what the extractor reads, and is kept on the capture", async () => {
      mockReadBody.mockResolvedValue(body({ selection: PASSAGE }));

      await handler({} as never);

      // The whole page is still archived — the selection says which part of it
      // to parse, and `oneshot.parse_page` prefers it to any selector.
      expect(dispatchExtraction).toHaveBeenCalledWith(
        expect.objectContaining({ contentOverride: PASSAGE }),
      );
      expect(mockBatchSet.mock.calls.at(-1)![1]).toMatchObject({
        selection: PASSAGE,
      });
    });

    it("is null on an ordinary whole-page capture", async () => {
      // Stored rather than left absent, so a reader of the document can tell a
      // whole-page capture from one whose selection was lost.
      await handler({} as never);
      expect(mockBatchSet.mock.calls.at(-1)![1]).toMatchObject({
        selection: null,
      });
      expect(dispatchExtraction).toHaveBeenCalledWith(
        expect.objectContaining({ contentOverride: undefined }),
      );
    });

    it("makes a second run over a page that was already captured", async () => {
      // The point of the feature: the run over the whole article missed a fact
      // that is plainly in this paragraph. Same bytes, same url — so without
      // the selection in the key this would come back as a duplicate and
      // nothing would be extracted.
      duplicateQuery.get.mockResolvedValue({
        empty: false,
        docs: [
          {
            id: "page-existing",
            data: () => ({
              status: "done",
              selection: null,
              articleNodeId: "node-9",
              storagePath: "gs://koryta-pl-crawled/old.tar.gz",
            }),
          },
        ],
      });
      mockReadBody.mockResolvedValue(body({ selection: PASSAGE }));

      const result = await handler({} as never);

      expect(result).toMatchObject({ pageId: "page-1", duplicate: false });
      expect(dispatchExtraction).toHaveBeenCalledWith(
        expect.objectContaining({ contentOverride: PASSAGE }),
      );
      // The bytes are identical, so the second job points at the archive that
      // is already in the bucket instead of writing another copy of it.
      expect(mockSave).not.toHaveBeenCalled();
      expect(result.storagePath).toBe("gs://koryta-pl-crawled/old.tar.gz");
    });

    it("is a duplicate when the same passage is sent twice", async () => {
      duplicateQuery.get.mockResolvedValue({
        empty: false,
        docs: [
          { id: "page-whole", data: () => ({ selection: null }) },
          {
            id: "page-passage",
            data: () => ({ status: "done", selection: PASSAGE }),
          },
        ],
      });
      mockReadBody.mockResolvedValue(body({ selection: PASSAGE }));

      const result = await handler({} as never);

      expect(result).toMatchObject({ pageId: "page-passage", duplicate: true });
      expect(dispatchExtraction).not.toHaveBeenCalled();
    });

    it("matches a capture taken before selections existed", async () => {
      // Those documents have no `selection` field at all, which is why the
      // match is made in memory: Firestore's `== null` finds a field stored as
      // null and not one that is absent, so asked as a query every capture in
      // the collection today would look like a page nobody had captured.
      duplicateQuery.get.mockResolvedValue({
        empty: false,
        docs: [{ id: "page-old", data: () => ({ status: "done" }) }],
      });

      const result = await handler({} as never);

      expect(result).toMatchObject({ pageId: "page-old", duplicate: true });
      expect(mockSave).not.toHaveBeenCalled();
    });

    it("refuses one too short to ground a fact in", async () => {
      mockReadBody.mockResolvedValue(body({ selection: "Jan Kowalski" }));

      await expect(handler({} as never)).rejects.toThrow();
      expect(mockSave).not.toHaveBeenCalled();
      expect(dispatchExtraction).not.toHaveBeenCalled();
    });
  });

  it("keeps the capture when the extractor cannot be reached", async () => {
    // The html is already in the bucket and the nightly pipeline reads it from
    // there, so a failed dispatch is recorded rather than raised.
    dispatchExtraction.mockResolvedValue({
      dispatched: false,
      error: "extractor not configured",
    });

    const result = await handler({} as never);

    expect(result.status).toBe("ok");
    expect(result.captureStatus).toBe("error");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        "extraction.error": "extractor not configured",
      }),
    );
  });

  it("refuses anyone outside the datascience group", async () => {
    verifyIdToken.mockResolvedValue({ uid: "gosc" });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("refuses a page too big to be an article", async () => {
    mockReadBody.mockResolvedValue(
      body({
        html: gzipSync(Buffer.alloc(9 * 1024 * 1024, 0x61)).toString("base64"),
      }),
    );

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("refuses a url the bucket layout cannot be built from", async () => {
    mockReadBody.mockResolvedValue(body({ url: "not a url" }));

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockSave).not.toHaveBeenCalled();
  });
});

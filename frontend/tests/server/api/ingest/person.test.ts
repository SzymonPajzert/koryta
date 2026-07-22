import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRevisionTransaction } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/ingest/person.post";

// Mock dependencies
const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockBatch = vi.fn();
const mockCommit = vi.fn();
const mockRef = { id: "doc-ref-id" };

const mockDb = {
  collection: mockCollection,
  batch: mockBatch,
};

mockCollection.mockReturnValue({
  where: mockWhere,
  doc: mockDoc,
});
// Need to handle chaining: .where().where().limit().get()
const queryMock = {
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: mockGet,
};
mockWhere.mockImplementation(() => queryMock);
mockLimit.mockImplementation(() => queryMock);

mockDoc.mockReturnValue({
  id: "new-doc-id",
  ref: mockRef,
});
mockBatch.mockReturnValue({
  commit: mockCommit,
  set: vi.fn(),
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock("firebase-admin/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));

const mockBaseNodeFields = vi.fn().mockResolvedValue({});

vi.mock("../../../../server/utils/revisions", () => ({
  createRevisionTransaction: vi.fn(() => ({
    revisionRef: { id: "mock-revision-id", path: "mock/path" },
    targetRef: { id: "mock-target-id", path: "mock/target/path" },
  })),
  baseNodeFields: (...args: unknown[]) => mockBaseNodeFields(...args),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.useStorage = vi.fn(() => ({ clear: vi.fn() }));
  globalThis.readValidatedBody = async (event: any, parse: any) => {
    const body = await mockReadBody();
    try {
      return parse(body);
    } catch {
      throw { statusCode: 400, message: "Missing required fields" };
    }
  };
  return { mockReadBody };
});

describe("api/ingest/person", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);
  });

  it("should throw 400 if name is missing", async () => {
    mockReadBody.mockResolvedValue({});
    try {
      await handler({} as any);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e).toEqual({
        statusCode: 400,
        message: "Missing required fields",
      });
    }
  });

  it("should create edges to regions if elections are provided", async () => {
    mockReadBody.mockResolvedValue({
      name: "Test Person",
      parties: [],
      companies: [],
      elections: [
        {
          party: "Test Party",
          election_year: "2023",
          election_type: "Sejmik",
          teryt: "02",
        },
      ],
    });

    // Person query: Empty (creating new person)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "person-id", ref: mockRef });

    // Region 1 (02) query: Found
    const regionRef1 = { id: "region-id-02" };
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: regionRef1, id: "region-id-02" }],
    });

    // Edge 1 creation
    const edgeRef1 = { id: "edge-id-1" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] }); // Edge doesn't exist yet
    mockDoc.mockReturnValueOnce(edgeRef1);

    // Region 2 (0201) query: Not found, mock create
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const newRegionRef = { id: "region-id-0201" };
    mockDoc.mockReturnValueOnce(newRegionRef);

    // Edge 2 creation
    const edgeRef2 = { id: "edge-id-2" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] }); // Edge doesn't exist yet
    mockDoc.mockReturnValueOnce(edgeRef2);

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalled();

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef1,
      {
        source: "person-id",
        target: "region-id-02",
        type: "election",
        name: "kandydatura",
        position: "Sejmik",
        party: "Test Party",
        start_date: "2023-01-01",
      },
      true,
      false, // approve
      false, // published
    );
    expect(result.elections).toHaveLength(1);
  });

  it("stores the electoral committee a candidacy was run under", async () => {
    // The pipeline has always sent `committee`; the schema used to strip it, so
    // no stored candidacy has one - which is most of why two candidacies in one
    // town in one year cannot be told apart.
    mockReadBody.mockResolvedValue({
      name: "Test Person",
      parties: [],
      companies: [],
      elections: [
        {
          committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
          election_year: "2024",
          election_type: "Samorząd",
          teryt: "1465",
        },
      ],
    });

    // The test above queues more `...Once` results than it consumes, and
    // clearAllMocks does not drain that queue.
    mockGet.mockReset();
    mockDoc.mockReset();
    mockDoc.mockReturnValue({ id: "new-doc-id", ref: mockRef });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "person-id", ref: mockRef });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: { id: "teryt1465" }, id: "teryt1465" }],
    });
    const edgeRef = { id: "edge-id" };
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      expect.objectContaining({
        type: "election",
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
      }),
      true,
      false,
      false,
    );
  });

  describe("a person the database already has", () => {
    /** Queue a lookup that finds `nodes` already holding this person. */
    function personExists(stored: Record<string, unknown>) {
      mockGet.mockReset();
      mockDoc.mockReset();
      mockDoc.mockReturnValue({ id: "person-id", ref: mockRef });
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: "person-id", ref: mockRef }],
      });
      mockBaseNodeFields.mockResolvedValue(stored);
    }

    it("writes the party the pipeline has learned since", async () => {
      // The whole point of mapping committees to parties: 6077 people are
      // already stored, and until now nothing the pipeline learned about one
      // of them was ever written back.
      personExists({ name: "Test Person", type: "person", parties: [] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        { uid: "test-user-id" },
        expect.anything(),
        expect.objectContaining({ parties: ["PiS"] }),
        true,
        false,
      );
    });

    it("keeps what it already knew", async () => {
      // A revision is written to the node wholesale, so anything the payload
      // does not mention has to be carried over or it is deleted.
      personExists({
        name: "Test Person",
        type: "person",
        parties: ["PO"],
        wikipedia: "https://pl.wikipedia.org/wiki/Test",
      });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).toHaveBeenCalledWith(
        mockDb,
        expect.anything(),
        { uid: "test-user-id" },
        expect.anything(),
        expect.objectContaining({
          parties: ["PO", "PiS"],
          wikipedia: "https://pl.wikipedia.org/wiki/Test",
        }),
        true,
        false,
      );
    });

    it("writes nothing when it has nothing new to say", async () => {
      // Otherwise every nightly run leaves a revision on every person.
      personExists({ name: "Test Person", type: "person", parties: ["PiS"] });
      mockReadBody.mockResolvedValue({
        name: "Test Person",
        parties: ["PiS"],
        companies: [],
        elections: [],
      });

      await handler({} as any);

      expect(createRevisionTransaction).not.toHaveBeenCalled();
    });
  });
});

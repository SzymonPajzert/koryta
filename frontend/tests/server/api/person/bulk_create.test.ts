import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRevisionTransaction } from "../../../../server/utils/revisions";

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

vi.mock("../../../../server/utils/revisions", () => ({
  createRevisionTransaction: vi.fn(),
}));

// Stub global readBody
const mockReadBody = vi.fn();
vi.stubGlobal("readBody", mockReadBody);
vi.stubGlobal("createError", (err: any) => err); // Mock createError to just return the error object/string
vi.stubGlobal("defineEventHandler", (fn: any) => fn); // Stub defineEventHandler to return the function as is

describe("api/person/bulk_create", () => {
  let handler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);

    // Dynamic import to ensure globals are stubbed before execution
    const mod = await import("../../../../server/api/person/bulk_create.post");
    handler = mod.default;
  });

  it("should throw 400 if name is missing", async () => {
    mockReadBody.mockResolvedValue({});

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing required person name",
    });
  });

  it("should create edges to regions if elections are provided", async () => {
    mockReadBody.mockResolvedValue({
      name: "Test Person",
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

    expect(createRevisionTransaction).toHaveBeenCalledWith(
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef1,
      {
        source: "person-id",
        target: "region-id-02",
        type: "election",
        name: "kandydatura",
        party: "Test Party",
        start_date: "2023-01-01",
      },
    );
    expect(result.elections).toHaveLength(1);
  });
});

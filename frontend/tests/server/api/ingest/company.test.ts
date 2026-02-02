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

describe("api/ingest/company", () => {
  let handler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);

    // Dynamic import to ensure globals are stubbed before execution
    const mod = await import("../../../../server/api/ingest/company.post");
    handler = mod.default;
  });

  it("should throw 400 if krs is missing", async () => {
    mockReadBody.mockResolvedValue({ name: "Test Company" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing required fields (krs, name)",
    });
  });

  it("should create a new company if it doesn't exist", async () => {
    mockReadBody.mockResolvedValue({ krs: "12345", name: "New Company" });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    // doc() returns a reference, not an object containing ref
    mockDoc.mockReturnValue(mockRef);

    const result = await handler({} as any);

    expect(mockCollection).toHaveBeenCalledWith("nodes");
    expect(mockDoc).toHaveBeenCalled(); // Should call doc() for new ID
    expect(createRevisionTransaction).toHaveBeenCalledWith(
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      mockRef,
      {
        name: "New Company",
        type: "place",
        krsNumber: "12345",
        content: "",
      },
    );
    // ref.id is accessed in handler return statement
    expect(result).toEqual({ id: "doc-ref-id", code: 201 });
  });

  it("should update an existing company", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
      content: "New Content",
    });

    const existingRef = { id: "existing-id" };
    const existingDoc = {
      ref: existingRef,
      data: () => ({ content: "Old Content" }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    const result = await handler({} as any);

    expect(mockDoc).not.toHaveBeenCalled(); // Should use existing doc ref
    expect(createRevisionTransaction).toHaveBeenCalledWith(
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef, // Expect the ref from the doc
      {
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
        content: "New Content",
      },
    );
    expect(result).toEqual({ id: "existing-id", code: 200 });
  });

  it("should create edges for owned companies", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Parent Company",
      owns: ["67890"],
    });

    // Parent query: Empty (creating new parent)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "parent-id", ref: mockRef });

    // Child query: Found
    const childRef = { id: "child-id" };
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: childRef }],
    });

    // Edge creation
    const edgeRef = { id: "edge-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    // Verify Edge Creation
    expect(createRevisionTransaction).toHaveBeenCalledWith(
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "parent-id",
        target: "child-id",
        type: "owns",
      },
    );
  });
});

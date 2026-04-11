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

vi.stubGlobal("readValidatedBody", async (event: any, parse: any) => {
  const body = await mockReadBody();
  try {
    return parse(body);
  } catch {
    throw { statusCode: 400, message: "Missing required fields (krs, name)" };
  }
});

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
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      mockRef,
      {
        name: "New Company",
        type: "place",
        krsNumber: "12345",
      },
      true,
      true, // approve
    );
    // ref.id is accessed in handler return statement
    expect(result).toEqual({ id: "doc-ref-id", code: 200 });
  });

  it("should update an existing company", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
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
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef, // Expect the ref from the doc
      {
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      true,
      true, // approve
    );
    expect(result).toEqual({ id: "existing-id", code: 200 });
  });

  it("should create edges for owned companies", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Parent Company",
      owners: ["67890"],
    });

    // Parent query: Empty (creating new parent)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const parentRef = { id: "parent-id" };
    mockDoc.mockReturnValueOnce(parentRef);

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
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "child-id",
        target: "parent-id",
        type: "owns",
      },
      true,
      true, // approve
    );
  });

  it("should create edge to region if teryt is provided", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };

    mockDoc.mockReturnValueOnce(regionRefMock);

    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);
    await handler({} as any);
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "teryt1061",
        target: "company-id",
        type: "owns",
      },
      true,
      true, // approve
    );
  });

  it("should throw 404 if owned parent company does not exist", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Child Company",
      owners: ["99999"],
    });

    // Mock Child get (will create new)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "child-id" });

    // Mock Parent get -> returns empty
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 404,
      message: "Company with KRS 99999 not found",
    });
  });

  it("should truncate teryt if length > 4", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061999", // > 4 chars
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    // Mock region existence true for 'teryt1061'
    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "teryt1061", // Must have correctly sliced
        target: "company-id",
        type: "owns",
      },
      true,
      true,
    );
  });

  it("should throw 400 if region with teryt code does not exist", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Unknown Region Company",
      teryt: "9999",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });

    // Mock region missing
    const missingRegionSnapshot = { exists: false };
    const regionRefMock = {
      get: vi.fn().mockResolvedValue(missingRegionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    // Mock the fallback query missing
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Region with TERYT code 9999 not found",
    });
  });
});

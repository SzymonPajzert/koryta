import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRevisionsForNodes,
  createRevisionTransaction,
} from "../../../server/utils/revisions";
import type {
  Firestore,
  WriteBatch,
  DocumentReference,
} from "firebase-admin/firestore";

// Mock Firestore
const mockGet = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockCollection = vi.fn().mockReturnValue({
  where: mockWhere,
  get: mockGet,
  doc: vi.fn(),
});
const mockBatch = {
  set: vi.fn(),
} as unknown as WriteBatch;

const mockDb = {
  collection: mockCollection,
  batch: vi.fn().mockReturnValue(mockBatch),
} as unknown as Firestore;

describe("createRevisionTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
  });

  it("should create a revision and NOT update head when updateHead=false", () => {
    const user = { uid: "test-user" };
    const targetRef = { id: "node-1" } as DocumentReference;
    const data = { title: "New Title" };

    createRevisionTransaction(mockDb, mockBatch, user, targetRef, data, false);

    // Should create revision
    expect(mockCollection).toHaveBeenCalledWith("revisions");
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    // Verify first call is setting revision
    const firstCallArgs = vi.mocked(mockBatch.set).mock.calls[0];
    expect(firstCallArgs[1]).toMatchObject({
      node_id: "node-1",
      data: data,
      update_user: "test-user",
    });
  });
});

describe("getRevisionsForNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty object for empty input", async () => {
    const result = await getRevisionsForNodes(mockDb, []);
    expect(result).toEqual({});
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it("should fetch revisions for nodes in chunks", async () => {
    // Generate 15 IDs to force 2 chunks (since chunk size is 10)
    const ids = Array.from({ length: 15 }, (_, i) => `id-${i}`);

    mockGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: "rev-1",
            data: () => ({ node_id: "id-0", title: "Rev 1" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [],
      });

    const result = await getRevisionsForNodes(mockDb, ids);

    // Should call collection('revisions')
    expect(mockCollection).toHaveBeenCalledWith("revisions");

    // Should split into two calls
    expect(mockWhere).toHaveBeenCalledTimes(2);
    // First chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      1,
      "node_id",
      "in",
      ids.slice(0, 10),
    );
    // Second chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      2,
      "node_id",
      "in",
      ids.slice(10),
    );

    // Check result mapping
    expect(result["id-0"]).toHaveLength(1);
    expect(result["id-0"][0]).toEqual({
      id: "rev-1",
      node_id: "id-0",
      title: "Rev 1",
    });
    expect(result["id-1"]).toEqual([]);
  });

  it("should correctly group revisions by node_id", async () => {
    const ids = ["node-A", "node-B"];

    mockGet.mockResolvedValue({
      docs: [
        {
          id: "rev-A1",
          data: () => ({ node_id: "node-A", ver: 1 }),
        },
        {
          id: "rev-A2",
          data: () => ({ node_id: "node-A", ver: 2 }),
        },
        {
          id: "rev-B1",
          data: () => ({ node_id: "node-B", ver: 1 }),
        },
      ],
    });

    const result = await getRevisionsForNodes(mockDb, ids);

    expect(result["node-A"]).toHaveLength(2);
    expect(result["node-B"]).toHaveLength(1);
    expect(result["node-A"]).toEqual([
      { id: "rev-A1", node_id: "node-A", ver: 1 },
      { id: "rev-A2", node_id: "node-A", ver: 2 },
    ]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchNodes } from "../../../server/utils/fetch";

// Mock firebase
const mockGet = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockCollection = vi.fn().mockReturnValue({
  where: mockWhere,
  get: mockGet,
});
const mockGetFirestore = vi.fn().mockReturnValue({
  collection: mockCollection,
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => mockGetFirestore(),
}));

vi.mock("../../../server/utils/fetch", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../../server/utils/fetch")>();
  return {
    ...mod,
  };
});

vi.mock("../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));

describe("fetchNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      docs: [],
    });
  });

  it("should fetch all nodes when no filters are provided", async () => {
    await fetchNodes("person");
    expect(mockCollection).toHaveBeenCalledWith("nodes");
    expect(mockWhere).toHaveBeenCalledWith("type", "==", "person");
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("should filter by interesting when requested", async () => {
    await fetchNodes("person", { filters: { interesting: true } });
    expect(mockWhere).toHaveBeenCalledWith("interesting", "==", true);
  });

  it("should filter by posted when requested", async () => {
    await fetchNodes("person", { filters: { posted: true } });
    expect(mockWhere).toHaveBeenCalledWith("posted", "==", true);
  });

  it("should filter by article when requested", async () => {
    await fetchNodes("person", { filters: { article: true } });
    expect(mockWhere).toHaveBeenCalledWith("article", "==", true);
  });
});

describe("createNode", () => {
  it("placeholder for creation test", () => {
    expect(true).toBe(true);
  });
});

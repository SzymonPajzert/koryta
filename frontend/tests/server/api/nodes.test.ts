import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchNodes } from "../../../server/utils/fetch";

const {
  mockFilterWhere,
  mockFilterOr,
  mockGetFirestore,
  mockCollection,
  mockWhere,
  mockGet,
} = vi.hoisted(() => {
  globalThis.defineCachedFunction = (fn: any) => fn;
  globalThis.useEvent = () => ({ path: "/mock" });
  globalThis.logEventPath = () => {};
  globalThis.getValidatedQuery = async (event: any, parser: any) =>
    parser(event.query);
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.authCachedEventHandler = (fn: any) => fn;

  const mockGet = vi.fn();
  const mockWhere = vi.fn().mockReturnThis();
  const mockCollection = vi.fn().mockReturnValue({
    where: mockWhere,
    get: mockGet,
  });
  const mockGetFirestore = vi.fn().mockReturnValue({
    collection: mockCollection,
  });

  const mockFilterWhere = vi.fn().mockImplementation((field, op, val) => ({
    type: "where",
    field,
    op,
    val,
  }));
  const mockFilterOr = vi
    .fn()
    .mockImplementation((...args) => ({ type: "or", args }));

  return {
    mockFilterWhere,
    mockFilterOr,
    mockGetFirestore,
    mockCollection,
    mockWhere,
    mockGet,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => mockGetFirestore(),
  Filter: {
    where: mockFilterWhere,
    or: mockFilterOr,
  },
}));

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
  });

  it("should filter by single party", async () => {
    await fetchNodes("person", { personParties: "PiS", bypassCache: true });
    expect(mockFilterWhere).toHaveBeenCalledWith(
      "parties",
      "array-contains-any",
      ["PiS"],
    );
    expect(mockWhere).toHaveBeenCalledWith({
      type: "where",
      field: "parties",
      op: "array-contains-any",
      val: ["PiS"],
    });
  });

  it("should filter by multiple parties", async () => {
    await fetchNodes("person", {
      personParties: ["PiS", "PO"],
      bypassCache: true,
    });
    expect(mockFilterWhere).toHaveBeenCalledWith(
      "parties",
      "array-contains-any",
      ["PiS", "PO"],
    );
    expect(mockWhere).toHaveBeenCalledWith({
      type: "where",
      field: "parties",
      op: "array-contains-any",
      val: ["PiS", "PO"],
    });
  });

  it("should filter by no party (__NONE__)", async () => {
    await fetchNodes("person", {
      personParties: ["__NONE__"],
      bypassCache: true,
    });
    expect(mockFilterWhere).toHaveBeenCalledWith("parties", "==", []);
    expect(mockWhere).toHaveBeenCalledWith({
      type: "where",
      field: "parties",
      op: "==",
      val: [],
    });
  });

  it("should filter by multiple parties including __NONE__", async () => {
    await fetchNodes("person", {
      personParties: ["PiS", "__NONE__"],
      bypassCache: true,
    });
    expect(mockFilterWhere).toHaveBeenCalledWith(
      "parties",
      "array-contains-any",
      ["PiS"],
    );
    expect(mockFilterWhere).toHaveBeenCalledWith("parties", "==", []);
    expect(mockFilterOr).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalledWith({
      type: "or",
      args: [
        {
          type: "where",
          field: "parties",
          op: "array-contains-any",
          val: ["PiS"],
        },
        { type: "where", field: "parties", op: "==", val: [] },
      ],
    });
  });
});

describe("createNode", () => {
  it("placeholder for creation test", () => {
    expect(true).toBe(true);
  });
});

vi.mock("../../../server/utils/handlers", () => ({
  authCachedEventHandler: (fn: any) => fn,
}));

describe("index.get.ts handler", () => {
  it("should parse legacy party parameter and pass it as personParties", async () => {
    // We clear mockGet so we can check if fetchNodes was called with the right options
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ docs: [] });

    // Important: getValidatedQuery is mocked in vi.hoisted to return parser(event.query)
    const handlerModule = await import("../../../server/api/nodes/index.get");

    // Call the handler. Since type="person" is provided, it hits the cached path
    // which calls fetchNodes(query.type, opts)
    await handlerModule.default({
      query: { type: "person", party: "PO" },
    } as any);

    // Verify that the inner fetchNodes call passed "PO" to Filter
    expect(mockFilterWhere).toHaveBeenCalledWith(
      "parties",
      "array-contains-any",
      ["PO"],
    );
  });
});

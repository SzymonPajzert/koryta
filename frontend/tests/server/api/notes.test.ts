import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/notes.get";

const { mockNotesGet, mockCountGet, mockNodesWhere, mockNodesGet } = vi.hoisted(
  () => {
    const g = globalThis as Record<string, unknown>;
    g.createError = (opts: { statusCode: number; message?: string }) =>
      Object.assign(new Error(opts.message), opts);
    // Nitro auto-imports used by server/utils/fetch.ts at module load time.
    g.defineCachedFunction = (fn: unknown) => fn;
    g.authCachedEventHandler = (fn: unknown) => fn;
    g.useEvent = () => ({ path: "/mock" });
    g.logEventPath = () => {};

    return {
      mockNotesGet: vi.fn(),
      mockCountGet: vi.fn(),
      mockNodesWhere: vi.fn(),
      mockNodesGet: vi.fn(),
    };
  },
);

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query),
  };
});

vi.mock("firebase-admin/firestore", () => {
  const notesQuery = {
    orderBy: vi.fn(),
    offset: vi.fn(),
    limit: vi.fn(),
    get: mockNotesGet,
    count: vi.fn(() => ({ get: mockCountGet })),
  };
  notesQuery.orderBy.mockReturnValue(notesQuery);
  notesQuery.offset.mockReturnValue(notesQuery);
  notesQuery.limit.mockReturnValue(notesQuery);

  const nodesCollection = {
    where: mockNodesWhere.mockReturnValue({ get: mockNodesGet }),
  };

  return {
    getFirestore: () => ({
      collection: (name: string) =>
        name === "notes" ? notesQuery : nodesCollection,
    }),
    FieldPath: { documentId: () => "__name__" },
  };
});

const callHandler = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ query });

const noteDoc = (nodeId: string, userUid: string, sources: unknown[]) => ({
  data: () => ({ nodeId, userUid, sources }),
});

const nodeDoc = (id: string, name: string, type = "person") => ({
  id,
  data: () => ({ name, type }),
});

describe("/api/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountGet.mockResolvedValue({ data: () => ({ count: 0 }) });
    mockNotesGet.mockResolvedValue({ docs: [] });
    mockNodesGet.mockResolvedValue({ docs: [] });
  });

  it("returns flattened notes with author uid and node metadata", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("node-1", "user-a", [
          { note: "pierwsza", url: "https://a.example" },
          { note: "druga", url: "https://b.example" },
        ]),
        noteDoc("node-2", "user-b", [
          { note: "inna", url: "https://c.example" },
        ]),
      ],
    });
    mockNodesGet.mockResolvedValue({
      docs: [
        nodeDoc("node-1", "Jan Testowy", "person"),
        nodeDoc("node-2", "Spółka Testowa", "place"),
      ],
    });
    mockCountGet.mockResolvedValue({ data: () => ({ count: 2 }) });

    const result = (await callHandler({ limit: "10" })) as {
      notes: Record<string, unknown>[];
      total: number;
    };

    expect(result.total).toBe(2);
    expect(result.notes).toHaveLength(3);
    expect(result.notes[0]).toEqual({
      nodeId: "node-1",
      userUid: "user-a",
      content: "pierwsza",
      url: "https://a.example",
      name: "Jan Testowy",
      nodeType: "person",
    });
    expect(result.notes[2]).toMatchObject({
      userUid: "user-b",
      name: "Spółka Testowa",
      nodeType: "place",
    });
  });

  it("handles an empty notes collection without querying nodes", async () => {
    const result = (await callHandler({})) as {
      notes: unknown[];
      total: number;
    };

    expect(result.notes).toEqual([]);
    expect(result.total).toBe(0);
    // Firestore throws on `where(documentId(), "in", [])` - it must not be called.
    expect(mockNodesWhere).not.toHaveBeenCalled();
  });

  it("chunks node name lookups to at most 30 ids per query", async () => {
    const docs = Array.from({ length: 35 }, (_, i) =>
      noteDoc(`node-${i}`, "user-a", [{ note: `n${i}`, url: "" }]),
    );
    mockNotesGet.mockResolvedValue({ docs });
    mockCountGet.mockResolvedValue({ data: () => ({ count: 35 }) });

    await callHandler({ limit: "50" });

    expect(mockNodesWhere).toHaveBeenCalledTimes(2);
    expect(mockNodesWhere.mock.calls[0]?.[2]).toHaveLength(30);
    expect(mockNodesWhere.mock.calls[1]?.[2]).toHaveLength(5);
  });

  it("rejects limits above 50", async () => {
    await expect(callHandler({ limit: "51" })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

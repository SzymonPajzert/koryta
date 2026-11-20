import { describe, it, expect, vi, beforeEach } from "vitest";
// After the `vi.mock` calls in source order, but vitest hoists those above every
// import, so the handler still loads against the fakes below.
import handlerModule from "../../../../server/api/nodes/index.get";

/** /eksploruj/nowe asks for the person its url names once the queue has moved
 * past them - after the back button, a reload or a link - as a row like the
 * queue's own: `?id=` beside `limit`. */
const { state, fsQuery } = vi.hoisted(() => {
  globalThis.defineCachedFunction = (fn: unknown) => fn;
  globalThis.useEvent = () => ({ path: "/mock" });
  globalThis.getValidatedQuery = async (
    event: { query: unknown },
    parser: (q: unknown) => unknown,
  ) => parser(event.query);

  const state: {
    docs: { id: string; data: () => Record<string, unknown> }[];
  } = { docs: [] };

  const fsQuery: Record<string, unknown> = {};
  for (const method of ["orderBy", "offset", "limit"]) {
    fsQuery[method] = vi.fn(() => fsQuery);
  }
  // Applied for real, so a test sees the rows the clauses would return.
  fsQuery.where = vi.fn((field: unknown, op: string, value: unknown) => {
    state.docs = state.docs.filter((doc) =>
      field === "__name__"
        ? doc.id === value
        : doc.data()[field as string] === value,
    );
    return fsQuery;
  });
  fsQuery.get = vi.fn(async () => ({ docs: state.docs }));
  fsQuery.count = vi.fn(() => ({
    get: async () => ({ data: () => ({ count: state.docs.length }) }),
  }));

  return { state, fsQuery };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => fsQuery }),
  FieldPath: { documentId: () => "__name__" },
  Filter: { where: vi.fn(), or: vi.fn() },
}));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "editor" }),
}));

vi.mock("../../../../server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
  editorFreshCachedEventHandler: (fn: unknown) => fn,
  wantsLatest: () => false,
}));

const node = (id: string, data: Record<string, unknown>) => ({
  id,
  data: () => data,
});

async function list(query: Record<string, string>) {
  // @ts-expect-error the default export may already be the handler
  const handler = handlerModule.default || handlerModule;
  return (await handler({ query })) as {
    nodes: Record<string, { id: string; name: string }>;
    total: number;
  };
}

describe("/api/nodes?id=", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.docs = [
      node("anna", {
        type: "person",
        name: "Anna Nowak",
        stats: { isApproved: false },
      }),
      node("jan", {
        type: "person",
        name: "Jan Kowalski",
        stats: { isApproved: false },
      }),
    ];
  });

  it("answers with that one page, as a row", async () => {
    const result = await list({ type: "person", limit: "1", id: "jan" });

    expect(Object.keys(result.nodes)).toEqual(["jan"]);
    expect(result.nodes.jan).toMatchObject({ id: "jan", name: "Jan Kowalski" });
    expect(fsQuery.where).toHaveBeenCalledWith("__name__", "==", "jan");
  });

  it("asks Firestore for the id first, ahead of every other filter", async () => {
    // The missing-index fallback moves filters into memory from the end; the
    // id first means it is the last to go, and never a read of every person.
    await list({ type: "person", limit: "1", id: "jan" });

    expect(vi.mocked(fsQuery.where).mock.calls[0]).toEqual([
      "__name__",
      "==",
      "jan",
    ]);
  });

  it("answers with nobody for an id that is not there", async () => {
    const result = await list({ type: "person", limit: "1", id: "gone" });

    expect(result).toEqual({ nodes: {}, total: 0 });
  });
});

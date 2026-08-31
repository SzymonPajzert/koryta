import { describe, it, expect, vi, beforeEach } from "vitest";
// After the `vi.mock` calls in source order, but vitest hoists those above every
// import, so the handler still loads against the fakes below.
import handlerModule from "../../../../server/api/nodes/index.get";

/** The explore table asks /api/nodes for a page of rows. A page merged away
 * keeps its document so its url still resolves (server/utils/merge.ts), and
 * `visibility=private` is `stats.isApproved == false` - which is exactly where
 * a tombstone lands, since `pageIsPublic` reads `deleted`. So the merged-away
 * duplicates went on being rows for anybody logged in. */
const { state, mockCollection, fsQuery } = vi.hoisted(() => {
  globalThis.defineCachedFunction = (fn: unknown) => fn;
  globalThis.useEvent = () => ({ path: "/mock" });
  globalThis.getValidatedQuery = async (
    event: { query: unknown },
    parser: (q: unknown) => unknown,
  ) => parser(event.query);

  const state: { docs: { id: string; data: () => unknown }[] } = { docs: [] };

  const fsQuery: Record<string, unknown> = {};
  for (const method of ["where", "orderBy", "offset", "limit"]) {
    fsQuery[method] = vi.fn(() => fsQuery);
  }
  fsQuery.get = vi.fn(async () => ({ docs: state.docs }));
  fsQuery.count = vi.fn(() => ({
    get: async () => ({ data: () => ({ count: state.docs.length }) }),
  }));

  return { state, mockCollection: vi.fn(() => fsQuery), fsQuery };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mockCollection }),
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
    nodes: Record<string, { id: string }>;
    total: number;
  };
}

describe("/api/nodes listing", () => {
  beforeEach(() => {
    state.docs = [];
    vi.clearAllMocks();
  });

  it("leaves a merged-away duplicate out of the rows", async () => {
    state.docs = [
      node("survivor", {
        type: "person",
        name: "TAIDA MUCHLA JASTRZĘBSKA",
        stats: { isApproved: false },
      }),
      node("duplicate", {
        type: "person",
        name: "TAIDA MUCHLA JASTRZĘBSKA",
        stats: { isApproved: false },
        deleted: true,
        merged_into: "survivor",
      }),
    ];

    const result = await list({
      type: "person",
      visibility: "private",
      limit: "10",
    });

    expect(Object.keys(result.nodes)).toEqual(["survivor"]);
  });

  it("keeps an ordinary unpublished page", async () => {
    state.docs = [
      node("draft", {
        type: "person",
        name: "Nobody",
        stats: { isApproved: false },
      }),
    ];

    const result = await list({
      type: "person",
      visibility: "private",
      limit: "10",
    });

    expect(Object.keys(result.nodes)).toEqual(["draft"]);
    expect(fsQuery.where).toHaveBeenCalledWith("stats.isApproved", "==", false);
  });
});

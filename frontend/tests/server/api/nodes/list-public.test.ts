import { describe, it, expect, vi, beforeEach } from "vitest";
import handlerModule from "../../../../server/api/nodes/index.get";

/** /api/nodes as each kind of reader gets it, through the real
 * `editorFreshCachedEventHandler` and `wantsLatest`: only the token check, the
 * nitro cache and Firestore are stood in for. */
const { state, mockCollection } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.setResponseHeader = (() => {}) as never;
  globalThis.getValidatedQuery = (async (
    event: { query: unknown },
    parser: (q: unknown) => unknown,
  ) => parser(event.query)) as never;

  const state: { docs: { id: string; data: () => unknown }[] } = { docs: [] };
  const fsQuery: Record<string, unknown> = {};
  for (const method of ["where", "orderBy", "offset", "limit"]) {
    fsQuery[method] = () => fsQuery;
  }
  fsQuery.get = async () => ({ docs: state.docs });
  fsQuery.count = () => ({
    get: async () => ({ data: () => ({ count: state.docs.length }) }),
  });
  return { state, mockCollection: () => fsQuery };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mockCollection }),
  Filter: { where: vi.fn(), or: vi.fn() },
}));
// A bearer header is a signed in reader, for both of the ways the route asks.
vi.mock("../../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization ? { uid: "editor" } : null,
  getUser: async (event: { headers?: Record<string, string> }) => {
    if (!event.headers?.authorization) throw { statusCode: 401 };
    return { uid: "editor" };
  },
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: (event: { query?: Record<string, string> }) => event.query ?? {},
}));

type Listed = {
  nodes: Record<
    string,
    { id: string; stats?: { edges?: Record<string, unknown> } }
  >;
};

async function list(query: Record<string, string>, signedIn = false) {
  // @ts-expect-error the default export may already be the handler
  const handler = handlerModule.default || handlerModule;
  return (await handler({
    query,
    headers: signedIn ? { authorization: "Bearer token" } : {},
    context: {},
  })) as Listed;
}

const stats = {
  isApproved: true,
  edges: {
    all: { targetNodeIds: ["company-1", "region-2", "company-3"] },
    approved: { targetNodeIds: ["company-1"] },
  },
};

describe("GET /api/nodes", () => {
  beforeEach(() => {
    state.docs = [
      {
        id: "published",
        data: () => ({
          type: "person",
          name: "Anna Nowak",
          published: true,
          parties: ["Partia A"],
          stats,
        }),
      },
      {
        id: "draft",
        data: () => ({
          type: "person",
          name: "Jan Kowalski",
          published: false,
          parties: ["Partia B"],
        }),
      },
    ];
  });

  it("lists a logged out reader the published pages alone", async () => {
    // On 2026-10-14 `?type=person` handed a logged out curl 10,904 people,
    // 9,653 of them unpublished and 2,657 of those with a party.
    const { nodes } = await list({ type: "person" });
    expect(Object.keys(nodes)).toEqual(["published"]);
  });

  it("lists a logged out reader who types `latest` the same", async () => {
    const { nodes } = await list({ type: "person", latest: "true" });
    expect(Object.keys(nodes)).toEqual(["published"]);
  });

  it("lists a signed in reader every page, drafts included", async () => {
    const { nodes } = await list({ type: "person", latest: "true" }, true);
    expect(Object.keys(nodes).sort()).toEqual(["draft", "published"]);
    expect(nodes.published!.stats!.edges).toHaveProperty("all");
  });

  it("does not tell a logged out reader where a page's drafts lead", async () => {
    const edges = (await list({ type: "person" })).nodes.published!.stats!
      .edges!;
    expect(edges).not.toHaveProperty("all");
    // Only how many: the "log in to see more" count is what read it.
    expect(edges.hiddenTargets).toBe(2);
  });

  it("does not tell them on a paginated page either", async () => {
    const { nodes } = await list({ type: "person", limit: "10" });
    expect(nodes.published!.stats!.edges).not.toHaveProperty("all");
  });

  it("leaves a signed in reader's paginated page whole", async () => {
    const { nodes } = await list({ type: "person", limit: "10" }, true);
    expect(nodes.published!.stats!.edges).toHaveProperty("all");
  });
});

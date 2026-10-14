import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id].get";

/** Node documents, keyed by id. */
let nodes: Record<string, Record<string, unknown>> = {};
/** Revisions, newest first, keyed by the node they are about. */
let revisions: Record<string, Record<string, unknown>[]> = {};
/** What the caller put in the url. */
let query: Record<string, string> = {};
/** Whether they sent a token that verifies. `latest` alone used to be taken
 * as the sign of a signed in reader; it is the token that decides now. */
let signedIn = false;
/** The `Cache-Control` the route answered with, if it set one. */
let cacheControl: string | undefined;

/** A signed in reader asking for the newest revision, which is what
 * `authFetch` sends on their behalf. */
function asSignedInEditor() {
  query = { latest: "true" };
  signedIn = true;
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      where: (_field: string, _op: string, nodeId: string) => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({
              docs: (revisions[nodeId] ?? []).map((data, index) => ({
                id: `rev-${index}`,
                data: () => data,
              })),
            }),
          }),
        }),
      }),
    })),
  })),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
// The real `editorFreshCachedEventHandler` and `wantsLatest`, with the token
// check standing in for Firebase: a bearer header is a signed in reader.
vi.mock("../../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization ? { uid: "editor" } : null,
}));
vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getQuery: () => query,
}));
vi.mock("../../../../server/utils/merge", () => ({
  resolveMergedNode: async (_db: unknown, id: string) => ({
    snapshot: {
      id,
      exists: nodes[id] !== undefined,
      data: () => nodes[id],
    },
  }),
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // The nitro cache, unwrapped: which path a request takes is the question,
  // not what the cache would have held.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedEventHandler = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.setResponseHeader = (_event: any, name: string, value: string) => {
    if (name === "Cache-Control") cacheControl = value;
  };
  // server/utils/fetch.ts, where `dropSearchIndex` lives, wraps a Nitro
  // auto-import at module load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "person-1");

const call = () =>
  handler({
    context: {},
    headers: signedIn ? { authorization: "Bearer token" } : {},
  } as never) as unknown as Promise<{
    node: {
      name: string;
      published?: boolean;
      stats?: { edges?: Record<string, unknown> };
    };
  }>;

describe("GET /api/nodes/[id]", () => {
  beforeEach(() => {
    globalThis.getRouterParam = vi.fn(() => "person-1");
    query = {};
    signedIn = false;
    cacheControl = undefined;
    nodes = {
      "person-1": {
        type: "person",
        name: "Anna Nowak",
        published: true,
        revision_id: "rev-0",
      },
    };
    revisions = {
      "person-1": [
        { data: { type: "person", name: "Anna Nowak (poprawiona)" } },
      ],
    };
  });

  it("answers a signed in reader from the newest revision", async () => {
    asSignedInEditor();
    expect((await call()).node.name).toBe("Anna Nowak (poprawiona)");
  });

  it("carries the document's published flag onto that revision", async () => {
    // A revision is what the page should say; whether anybody may read it
    // belongs to the document, and `INTERNAL_FIELDS` keeps the flag out of the
    // revision entirely. Without it every signed in reader was handed
    // `published: undefined` for a live page - and the „szkic" badge that reads
    // it marked the whole site a draft.
    asSignedInEditor();
    expect((await call()).node.published).toBe(true);
  });

  it("calls a draft a draft, whatever its revision says", async () => {
    nodes["person-1"]!.published = false;
    asSignedInEditor();
    expect((await call()).node.published).toBe(false);
  });

  it("still answers when the page has no revision at all", async () => {
    revisions = {};
    asSignedInEditor();
    const node = (await call()).node;
    expect(node.name).toBe("Anna Nowak");
    expect(node.published).toBe(true);
  });

  it("hides a draft from a reader who did not ask for the latest", async () => {
    nodes["person-1"]!.published = false;
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  // `revision_id: null` marks a page waiting for its first review, and the
  // shape check used to refuse it - so every one of them answered 500.
  it("hides a page waiting for its first review with a 404", async () => {
    nodes["person-1"]!.published = false;
    nodes["person-1"]!.revision_id = null;
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("serves a published page whose revision_id is null", async () => {
    nodes["person-1"]!.revision_id = null;
    expect((await call()).node.name).toBe("Anna Nowak");
  });

  it("still refuses a published page with no name", async () => {
    delete nodes["person-1"]!.name;
    await expect(call()).rejects.toThrow();
  });

  it("hands the newest revision to nobody who only types `latest`", async () => {
    // On 2026-10-14 this was a curl away: `?latest=true` with no token at all
    // answered with the newest revision of any page, published or not.
    query = { latest: "true" };
    expect((await call()).node.name).toBe("Anna Nowak");

    nodes["person-1"]!.published = false;
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not let `latest=false` past the 404 either", async () => {
    // The check was for any `latest` at all, so asking *not* to see the
    // drafts was enough to be shown a draft's stored page.
    nodes["person-1"]!.published = false;
    query = { latest: "false" };
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps the signed in reader's answer out of every cache", async () => {
    asSignedInEditor();
    await call();
    expect(cacheControl).toMatch(/no-store/);
  });

  it("keeps the public answer to a `latest` url out of every cache too", async () => {
    // Cloud CDN keys on the url, and the next reader to ask for it with a
    // token is an editor who must not be handed the public page.
    query = { latest: "true" };
    await call();
    expect(cacheControl).toMatch(/no-store/);
  });

  it("does not tell a logged out reader where a page's drafts lead", async () => {
    nodes["person-1"]!.stats = {
      edges: {
        all: { targetNodeIds: ["company-1", "region-9", "company-2"] },
        approved: { targetNodeIds: ["company-1"] },
      },
    };

    const edges = (await call()).node.stats!.edges!;
    expect(edges).not.toHaveProperty("all");
    expect(edges.approved).toEqual({ targetNodeIds: ["company-1"] });
    expect(edges.hiddenTargets).toBe(2);
  });

  // The search index is for /api/search's query; no reader needs it back.
  it("leaves the search index out of the page", async () => {
    nodes["person-1"]!.nameChunksLower = ["a", "an", "anna"];
    expect((await call()).node).not.toHaveProperty("nameChunksLower");
  });
});

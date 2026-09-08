import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id].get";

/** Node documents, keyed by id. */
let nodes: Record<string, Record<string, unknown>> = {};
/** Revisions, newest first, keyed by the node they are about. */
let revisions: Record<string, Record<string, unknown>[]> = {};
/** What the caller asked for, i.e. whether they are signed in - `authFetch`
 * puts `latest` on every request a signed in reader makes. */
let query: Record<string, string> = {};

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
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authCachedEventHandler: (fn: any) => fn,
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
});
globalThis.getRouterParam = vi.fn(() => "person-1");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.getValidatedQuery = (async (_event: unknown, validate: any) =>
  validate(query)) as never;

const call = () =>
  handler({} as never) as unknown as Promise<{
    node: { name: string; published?: boolean };
  }>;

describe("GET /api/nodes/[id]", () => {
  beforeEach(() => {
    globalThis.getRouterParam = vi.fn(() => "person-1");
    query = {};
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
    query = { latest: "true" };
    expect((await call()).node.name).toBe("Anna Nowak (poprawiona)");
  });

  it("carries the document's published flag onto that revision", async () => {
    // A revision is what the page should say; whether anybody may read it
    // belongs to the document, and `INTERNAL_FIELDS` keeps the flag out of the
    // revision entirely. Without it every signed in reader was handed
    // `published: undefined` for a live page - and the „szkic" badge that reads
    // it marked the whole site a draft.
    query = { latest: "true" };
    expect((await call()).node.published).toBe(true);
  });

  it("calls a draft a draft, whatever its revision says", async () => {
    nodes["person-1"]!.published = false;
    query = { latest: "true" };
    expect((await call()).node.published).toBe(false);
  });

  it("still answers when the page has no revision at all", async () => {
    revisions = {};
    query = { latest: "true" };
    const node = (await call()).node;
    expect(node.name).toBe("Anna Nowak");
    expect(node.published).toBe(true);
  });

  it("hides a draft from a reader who did not ask for the latest", async () => {
    nodes["person-1"]!.published = false;
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });
});

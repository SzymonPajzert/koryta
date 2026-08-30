import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/nodes/[id]/mentions.get";

/** The double from `articles/relations.test.ts`: this is the same join read
 * from the other end, so it needs the same two tables. */
let edges: Record<string, Record<string, unknown>> = {};
let nodes: Record<string, Record<string, unknown>> = {};
let latest = false;

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({ doc: (id: string) => ({ id }) })),
    getAll: async (...refs: { id: string }[]) =>
      refs.map((ref) => ({ id: ref.id, data: () => nodes[ref.id] })),
  })),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => latest,
}));
vi.mock("../../../../server/utils/edgePublication", () => ({
  fetchEdgesForNode: async (_db: unknown, nodeId: string) =>
    Object.entries(edges)
      .filter(([, e]) => e.source === nodeId || e.target === nodeId)
      .map(([id, e]) => ({ id, ...e })),
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "person-1");

const call = () =>
  handler({} as never) as unknown as Promise<{
    mentions: {
      nodeId: string;
      name: string | null;
      published: boolean;
      publishedDate: string | null;
    }[];
  }>;

const article = (name: string, extra: Record<string, unknown> = {}) => ({
  type: "article",
  name,
  published: true,
  sourceURL: `https://example.pl/${name}`,
  ...extra,
});

describe("GET /api/nodes/[id]/mentions", () => {
  beforeEach(() => {
    latest = false;
    globalThis.getRouterParam = vi.fn(() => "person-1");
    nodes = {
      "person-1": { type: "person", name: "Anna Nowak", published: true },
      "article-1": article("a"),
      "article-2": article("b"),
    };
    edges = {};
  });

  it("reads a mention the pipeline wrote, pointing person -> article", async () => {
    // `ingest/person.post.ts` writes them this way round and produced most of
    // the ones in the database.
    edges.m1 = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };

    const { mentions } = await call();
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ nodeId: "article-1", name: "a" });
  });

  it("reads one the app wrote, pointing article -> person", async () => {
    edges.m1 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: true,
    };

    const { mentions } = await call();
    expect(mentions.map((m) => m.nodeId)).toEqual(["article-1"]);
  });

  it("shows one article once when both writers recorded it", async () => {
    edges.m1 = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: false,
    };
    edges.m2 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: true,
    };
    latest = true;

    const { mentions } = await call();
    expect(mentions).toHaveLength(1);
    // The published copy is the one kept: it is what the public would be shown.
    expect(mentions[0]!.published).toBe(true);
  });

  it("hides a draft mention from the public and shows it to a reader", async () => {
    edges.m1 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: false,
    };

    expect((await call()).mentions).toEqual([]);
    latest = true;
    expect((await call()).mentions).toHaveLength(1);
  });

  it("withholds a draft article even when the edge is live", async () => {
    nodes["article-1"] = article("a", { published: false });
    edges.m1 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: true,
    };

    expect((await call()).mentions).toEqual([]);
  });

  it("ignores relations that are not mentions, and ends that are not articles", async () => {
    nodes["place-1"] = { type: "place", name: "Spółka", published: true };
    edges.e1 = {
      source: "person-1",
      target: "place-1",
      type: "employed",
      published: true,
    };
    // A mentions edge the ingest paths have written pointing at a non-article.
    edges.e2 = {
      source: "person-1",
      target: "place-1",
      type: "mentions",
      published: true,
    };

    expect((await call()).mentions).toEqual([]);
  });

  it("skips a deleted edge", async () => {
    edges.m1 = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
      deleted: true,
    };

    expect((await call()).mentions).toEqual([]);
  });

  it("puts the newest first and the undated last", async () => {
    nodes["article-1"] = article("a", {
      publishedDate: { toDate: () => new Date("2024-01-01") },
    });
    nodes["article-2"] = article("b", {
      // The shape the sanitizer used to leave behind, still in the database.
      publishedDate: { _seconds: Date.parse("2025-06-01") / 1000 },
    });
    nodes["article-3"] = article("c");
    for (const [i, id] of ["article-1", "article-2", "article-3"].entries()) {
      edges[`m${i}`] = {
        source: "person-1",
        target: id,
        type: "mentions",
        published: true,
      };
    }

    const { mentions } = await call();
    expect(mentions.map((m) => m.nodeId)).toEqual([
      "article-2",
      "article-1",
      "article-3",
    ]);
    expect(mentions[1]!.publishedDate).toBe("2024-01-01T00:00:00.000Z");
  });
});

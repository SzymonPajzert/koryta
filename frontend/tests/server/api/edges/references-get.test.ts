import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/[id]/references.get";

/** Every document, keyed by `collection/id`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
/** Whether the caller asked to be shown drafts. */
let latest = false;

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => ({
      id,
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
  })),
  // Firestore answers a `getAll` for a missing document with a snapshot that
  // exists: false, which is what makes a dangling reference visible at all.
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/handlers", () => ({
  wantsLatest: () => latest,
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

globalThis.getRouterParam = vi.fn(() => "edge-1");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = () => (handler as any)({} as never);

describe("GET /api/edges/[id]/references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latest = false;
    stored = {
      "edges/edge-1": { references: ["article-1", "article-2"] },
      "nodes/article-1": {
        type: "article",
        name: "Zet o spółce",
        sourceURL: "https://zet.pl/tekst",
        published: true,
      },
      "nodes/article-2": { type: "article", name: "Szkic", published: false },
    };
  });

  it("names the articles a relation rests on", async () => {
    latest = true;
    const result = await call();

    expect(result.sources).toEqual([
      {
        id: "article-2",
        name: "Szkic",
        sourceURL: null,
        published: false,
      },
      {
        id: "article-1",
        name: "Zet o spółce",
        sourceURL: "https://zet.pl/tekst",
        published: true,
      },
    ]);
  });

  it("keeps a draft article to editors only", async () => {
    const result = await call();

    expect(result.sources.map((source: { id: string }) => source.id)).toEqual([
      "article-1",
    ]);
  });

  it("shows an editor a citation whose article is gone", async () => {
    // Nothing else would: the id is only ever rendered through a node lookup,
    // so a reference to a removed page is invisible on every page that has one.
    latest = true;
    stored["edges/edge-1"] = { references: ["article-1", "ghost"] };
    const result = await call();

    expect(result.sources).toContainEqual({
      id: "ghost",
      name: null,
      sourceURL: null,
      published: false,
    });
  });

  it("reads a sanitized references field", async () => {
    // Written through `sanitizeFirestoreData` from inside an array, references
    // is a map with numbered keys rather than a list.
    latest = true;
    stored["edges/edge-1"] = { references: { "0": "article-1" } };
    const result = await call();

    expect(result.sources.map((source: { id: string }) => source.id)).toEqual([
      "article-1",
    ]);
  });

  it("answers an edge with no sources with an empty list", async () => {
    stored["edges/edge-1"] = {};
    const result = await call();

    expect(result).toEqual({ id: "edge-1", sources: [] });
    expect(mockDb.getAll).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a relation", async () => {
    stored["edges/edge-1"] = undefined;

    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });
});

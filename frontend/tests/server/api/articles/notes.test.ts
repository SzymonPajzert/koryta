import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/articles/[id]/notes.get";
import type { NoteRow } from "../../../../shared/model";

/** What `getNoteRows` would hand back, which the handler then filters. */
let rows: NoteRow[] = [];
/** Every node, keyed by id. */
let nodes: Record<string, Record<string, unknown> | undefined> = {};
let user: { uid: string } | null = { uid: "reader-uid" };

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: nodes[id] !== undefined,
          data: () => nodes[id],
        }),
      }),
    })),
  })),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/notes", () => ({
  getNoteRows: async () => rows,
}));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: async () => {
    if (!user) throw { statusCode: 401 };
    return user;
  },
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "article-1");

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  key: "note-1:0",
  noteId: "note-1",
  sourceIndex: 0,
  nodeId: "person-1",
  nodeName: "Anna Nowak",
  nodeType: "person",
  userUid: "someone",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: null,
  note: "Warto przeczytać",
  url: null,
  kind: "source",
  articleNodeId: null,
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...overrides,
});

const call = () => handler({} as never);

describe("GET /api/articles/[id]/notes", () => {
  beforeEach(() => {
    user = { uid: "reader-uid" };
    globalThis.getRouterParam = vi.fn(() => "article-1");
    nodes = {
      "article-1": { type: "article", sourceURL: "https://www.example.pl/a/" },
    };
    rows = [];
  });

  it("takes the entries the promotion stamped with this article", async () => {
    rows = [row({ articleNodeId: "article-1" }), row({ key: "n2:0" })];

    const { notes } = await call();
    expect(notes.map((n) => n.key)).toEqual(["note-1:0"]);
  });

  it("takes an entry that cites the same page under another spelling", async () => {
    // Everything written before the promotion existed carries no stamp, and a
    // correction or a gap report carries a url and is never promoted at all.
    rows = [
      row({ key: "n1:0", url: "example.pl/a" }),
      row({ key: "n2:0", url: "https://example.pl/a", kind: "change_request" }),
      row({ key: "n3:0", url: "https://example.pl/inny-tekst" }),
    ];

    const { notes } = await call();
    expect(notes.map((n) => n.key)).toEqual(["n1:0", "n2:0"]);
  });

  it("leaves out the article's own notes, which the editor below shows", async () => {
    rows = [
      row({ key: "own:0", nodeId: "article-1", articleNodeId: "article-1" }),
      row({ key: "other:0", articleNodeId: "article-1" }),
    ];

    const { notes } = await call();
    expect(notes.map((n) => n.key)).toEqual(["other:0"]);
  });

  it("carries the node the note was written on, which is the point of it", async () => {
    rows = [row({ articleNodeId: "article-1" })];

    const { notes } = await call();
    expect(notes[0]).toMatchObject({
      nodeId: "person-1",
      nodeName: "Anna Nowak",
      nodeType: "person",
    });
  });

  it("refuses a signed out caller", async () => {
    // Notes on a person are withheld from logged out readers on the person's
    // own page; this must not be the way around that.
    user = null;
    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("404s for an id that is not an article", async () => {
    nodes["article-1"] = { type: "person", name: "Anna" };
    await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("still matches by id when the article has no url to compare", async () => {
    nodes["article-1"] = { type: "article" };
    rows = [
      row({ articleNodeId: "article-1" }),
      row({ key: "n2:0", url: "x" }),
    ];

    const { notes } = await call();
    expect(notes.map((n) => n.key)).toEqual(["note-1:0"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/notes/admin.get";
import { resetNoteNodeNames } from "../../../server/utils/notes";
import type { NoteRow } from "../../../shared/model";

const { mockGetUser, mockNotesGet, mockGetAll, mockRevisionsGet } = vi.hoisted(
  () => {
    (globalThis as Record<string, unknown>).createError = (opts: {
      statusCode: number;
      message?: string;
    }) => Object.assign(new Error(opts.message), opts);

    return {
      mockGetUser: vi.fn(),
      mockNotesGet: vi.fn(),
      mockGetAll: vi.fn(),
      mockRevisionsGet: vi.fn(),
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

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/firestore", () => {
  const revisionsQuery = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: mockRevisionsGet,
  };
  revisionsQuery.where.mockReturnValue(revisionsQuery);
  revisionsQuery.orderBy.mockReturnValue(revisionsQuery);
  revisionsQuery.limit.mockReturnValue(revisionsQuery);

  return {
    getFirestore: () => ({
      collection: (name: string) =>
        name === "notes"
          ? { get: mockNotesGet }
          : name === "revisions"
            ? revisionsQuery
            : { doc: (id: string) => ({ id }) },
      getAll: mockGetAll,
    }),
  };
});

const callHandler = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ query });

type Result = { notes: NoteRow[]; total: number };

const noteDoc = (
  id: string,
  data: Record<string, unknown>,
  updateTime = "2026-01-01T00:00:00.000Z",
) => ({ id, data: () => data, updateTime });

const nodeDoc = (id: string, name: string, type = "person") => ({
  id,
  data: () => ({ name, type }),
});

describe("/api/notes/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNoteNodeNames();
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockNotesGet.mockResolvedValue({ docs: [] });
    mockGetAll.mockResolvedValue([]);
    mockRevisionsGet.mockResolvedValue({ docs: [] });
  });

  it("rejects callers without the admin claim", async () => {
    mockGetUser.mockResolvedValue({ uid: "user-1" });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockNotesGet).not.toHaveBeenCalled();
  });

  it("flattens each source into its own row, newest first", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-old", {
          nodeId: "node-1",
          userUid: "user-a",
          createdAt: "2026-01-02T00:00:00.000Z",
          sources: [
            { note: "pierwsza", url: "https://a.example" },
            { note: "druga", kind: "change_request" },
          ],
        }),
        noteDoc("note-new", {
          nodeId: "node-2",
          userUid: "user-b",
          createdAt: "2026-03-01T00:00:00.000Z",
          sources: [{ note: "inna" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([
      nodeDoc("node-1", "Jan Testowy", "person"),
      nodeDoc("node-2", "Spółka Testowa", "place"),
    ]);

    const result = (await callHandler()) as Result;

    expect(result.total).toBe(3);
    expect(result.notes[0]).toMatchObject({
      key: "note-new:0",
      nodeName: "Spółka Testowa",
      nodeType: "place",
      userUid: "user-b",
    });
    expect(result.notes[1]).toEqual({
      key: "note-old:0",
      noteId: "note-old",
      sourceIndex: 0,
      nodeId: "node-1",
      nodeName: "Jan Testowy",
      nodeType: "person",
      userUid: "user-a",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: null,
      note: "pierwsza",
      url: "https://a.example",
      // Entries written before kinds existed read back as sources.
      kind: "source",
      // Null until promoting the source makes an article of it, which is what
      // tells an entry that has been through it from one that has not.
      articleNodeId: null,
      adminStatus: null,
      adminType: null,
      adminTypeDeferred: false,
    });
    expect(result.notes[2]).toMatchObject({ kind: "change_request" });
  });

  it("dates a note that was never edited by when it was created", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("legacy", {
          nodeId: "node-1",
          userUid: "user-a",
          createdAt: "2025-06-01T10:00:00.000Z",
          sources: [{ note: "stara" }],
        }),
      ],
    });

    const result = (await callHandler()) as Result;

    expect(result.notes[0]?.createdAt).toBe("2025-06-01T10:00:00.000Z");
    // Never edited, so there is no later date to confuse it with.
    expect(result.notes[0]?.updatedAt).toBeNull();
  });

  it("ignores the document's own write time", async () => {
    // Triaging a source writes to the note document, so dating a note by
    // `doc.updateTime` moved it to the top of the queue the moment an admin
    // touched it. A note with neither field is undated rather than dated by
    // whoever last reviewed it.
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc(
          "untouched-by-the-migration",
          { nodeId: "node-1", userUid: "user-a", sources: [{ note: "stara" }] },
          "2026-08-02T09:00:00.000Z",
        ),
      ],
    });

    const result = (await callHandler()) as Result;

    expect(result.notes[0]?.createdAt).toBeNull();
    expect(result.notes[0]?.updatedAt).toBeNull();
  });

  it("keeps the write date and the edit date apart", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("edited", {
          nodeId: "node-1",
          userUid: "user-a",
          createdAt: "2025-06-01T10:00:00.000Z",
          updatedAt: "2026-01-15T12:00:00.000Z",
          sources: [{ note: "poprawiona" }],
        }),
      ],
    });

    const result = (await callHandler()) as Result;

    // The column shows when it was written; the edit is carried separately
    // rather than folded into it.
    expect(result.notes[0]?.createdAt).toBe("2025-06-01T10:00:00.000Z");
    expect(result.notes[0]?.updatedAt).toBe("2026-01-15T12:00:00.000Z");
  });

  it("resolves names of nodes that only exist as a proposed revision", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "proposed-1",
          userUid: "user-a",
          sources: [{ note: "o kimś nowym" }],
        }),
      ],
    });
    // Absent from `nodes`, so `getAll` returns a snapshot with no data.
    mockGetAll.mockResolvedValue([{ id: "proposed-1", data: () => undefined }]);
    mockRevisionsGet.mockResolvedValue({
      docs: [
        { data: () => ({ data: { name: "Nowa Osoba", type: "person" } }) },
      ],
    });

    const result = (await callHandler()) as Result;

    expect(result.notes[0]).toMatchObject({
      nodeName: "Nowa Osoba",
      nodeType: "person",
    });
  });

  it("filters by kind, node type and triage state", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "źródło" },
            { note: "poprawka", kind: "change_request" },
            {
              note: "załatwione",
              kind: "change_request",
              adminStatus: "resolved",
              adminType: "missing_data",
            },
          ],
        }),
        noteDoc("note-2", {
          nodeId: "node-2",
          userUid: "user-b",
          sources: [{ note: "o spółce", kind: "change_request" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([
      nodeDoc("node-1", "Jan Testowy", "person"),
      nodeDoc("node-2", "Spółka Testowa", "place"),
    ]);

    const byKind = (await callHandler({ kind: "change_request" })) as Result;
    expect(byKind.total).toBe(3);

    const byNodeType = (await callHandler({ nodeType: "place" })) as Result;
    expect(byNodeType.notes.map((n) => n.note)).toEqual(["o spółce"]);

    // "none" is the queue of entries nobody has looked at yet.
    const untriaged = (await callHandler({ status: "none" })) as Result;
    expect(untriaged.total).toBe(3);

    const resolved = (await callHandler({ status: "resolved" })) as Result;
    expect(resolved.notes.map((n) => n.note)).toEqual(["załatwione"]);

    const byAdminType = (await callHandler({
      adminType: "missing_data",
    })) as Result;
    expect(byAdminType.notes.map((n) => n.note)).toEqual(["załatwione"]);
  });

  it("selects the entries the dashboard counts as needing action", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            // A correction nobody has triaged: waiting on somebody by virtue
            // of being one. A reported gap counts the same way.
            { note: "poprawka", kind: "change_request" },
            { note: "brak zarządu", kind: "missing" },
            // The same, once a reviewer has settled it.
            {
              note: "załatwiona poprawka",
              kind: "change_request",
              adminStatus: "resolved",
            },
            // A source is only on the list if a reviewer put it there.
            { note: "źródło" },
            { note: "źródło do sprawdzenia", adminStatus: "unresolved" },
          ],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy", "person")]);

    const needsAction = (await callHandler({
      status: "needs_action",
    })) as Result;

    expect(needsAction.notes.map((n) => n.note)).toEqual([
      "poprawka",
      "brak zarządu",
      "źródło do sprawdzenia",
    ]);
    expect(needsAction.total).toBe(3);
  });

  it("answers a permalink with the one entry it names", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "pierwsza" },
            { note: "druga", adminStatus: "resolved" },
          ],
        }),
        noteDoc("note-2", {
          nodeId: "node-2",
          userUid: "user-b",
          sources: [{ note: "o spółce" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([
      nodeDoc("node-1", "Jan Testowy", "person"),
      nodeDoc("node-2", "Spółka Testowa", "place"),
    ]);

    const linked = (await callHandler({ note: "note-1:1" })) as Result;
    expect(linked.total).toBe(1);
    expect(linked.notes.map((n) => n.note)).toEqual(["druga"]);

    // The whole point of a permalink: a filter left over in the url beside it
    // cannot empty the page the link was sent to open.
    const despiteFilters = (await callHandler({
      note: "note-1:0",
      status: "resolved",
      nodeType: "place",
      q: "coś czego tam nie ma",
      page: 3,
    })) as Result;
    expect(despiteFilters.notes.map((n) => n.note)).toEqual(["pierwsza"]);

    // An entry that has since been deleted answers empty rather than falling
    // back to the whole queue.
    const gone = (await callHandler({ note: "note-1:9" })) as Result;
    expect(gone).toEqual({ notes: [], total: 0 });
  });

  it("serves the phone queue: untyped entries nobody handed back", async () => {
    // What /admin/notatki/kategoryzacja asks for. An entry a reviewer could
    // not classify there is marked deferred and must not come round again.
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "do oceny" },
            { note: "już opisana", adminType: "context" },
            { note: "nie da się z telefonu", adminTypeDeferred: true },
            // A type given in the table wins over an older deferral, so this
            // one is neither in the queue nor waiting for the table.
            {
              note: "odłożona i opisana",
              adminType: "other",
              adminTypeDeferred: true,
            },
          ],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const queue = (await callHandler({
      adminType: "none",
      deferred: "false",
    })) as Result;
    expect(queue.notes.map((n) => n.note)).toEqual(["do oceny"]);

    // The other half of the split: what the table view is being asked about.
    const forTheTable = (await callHandler({
      adminType: "none",
      deferred: "true",
    })) as Result;
    expect(forTheTable.notes.map((n) => n.note)).toEqual([
      "nie da się z telefonu",
    ]);

    // "none" on its own is every unclassified entry, deferred or not.
    const untyped = (await callHandler({ adminType: "none" })) as Result;
    expect(untyped.total).toBe(2);
  });

  it("searches the note, its url and the name of the node it is on", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "coś o przetargu" },
            { note: "bez związku", url: "https://przetargi.example" },
            { note: "trzecia" },
          ],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const byText = (await callHandler({ q: "PRZETARG" })) as Result;
    expect(byText.total).toBe(2);

    const byName = (await callHandler({ q: "testowy" })) as Result;
    expect(byName.total).toBe(3);
  });

  it("pages and sorts on a column the admin picked", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "a" }, { note: "b" }, { note: "c" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const firstPage = (await callHandler({ limit: "2" })) as Result;
    expect(firstPage.notes).toHaveLength(2);
    expect(firstPage.total).toBe(3);

    const secondPage = (await callHandler({ limit: "2", page: "2" })) as Result;
    expect(secondPage.notes).toHaveLength(1);
    expect(secondPage.total).toBe(3);

    const sorted = (await callHandler({
      sortBy: "nodeName",
      sortDesc: "false",
    })) as Result;
    expect(sorted.notes[0]?.nodeName).toBe("Jan Testowy");
  });

  it("shows a note written since the last request", async () => {
    // The queue exists to triage notes as they arrive, so nothing may cache
    // the list itself - an empty read must not outlive the write after it.
    mockNotesGet.mockResolvedValue({ docs: [] });
    expect(((await callHandler()) as Result).total).toBe(0);

    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "świeża" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const after = (await callHandler()) as Result;
    expect(after.notes.map((n) => n.note)).toEqual(["świeża"]);
  });

  it("resolves a node name once and reuses it across requests", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "a" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    await callHandler({ page: "1" });
    await callHandler({ page: "2" });
    await callHandler({ kind: "source" });

    // Re-read every time, joined once - the join is the expensive half.
    expect(mockNotesGet).toHaveBeenCalledTimes(3);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it("does not re-query a node id that resolved to nothing", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "ghost-1",
          userUid: "user-a",
          sources: [{ note: "o duchu" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([{ id: "ghost-1", data: () => undefined }]);
    mockRevisionsGet.mockResolvedValue({ docs: [] });

    await callHandler();
    await callHandler();

    expect(mockRevisionsGet).toHaveBeenCalledTimes(1);
    const result = (await callHandler()) as Result;
    expect(result.notes[0]?.nodeName).toBeNull();
  });

  it("rejects a limit the page would never ask for", async () => {
    await expect(callHandler({ limit: "500" })).rejects.toThrow();
  });
});

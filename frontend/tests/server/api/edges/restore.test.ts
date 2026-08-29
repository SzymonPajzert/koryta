import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/edges/restore.post";

const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};
let generated = 0;

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
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
  })),
  batch: vi.fn(() => ({
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    update: vi.fn(),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  // Only `now` is reached from here - nothing on this path reads the value
  // back, so the mock does not have to be constructible.
  Timestamp: { now: () => ({}) },
  FieldValue: { delete: () => "deleted" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadValidatedBody };
});

function request(body: Record<string, unknown>) {
  mockReadValidatedBody.mockImplementation(
    async (_event: unknown, parse: (b: unknown) => unknown) => {
      try {
        return parse(body);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

function edgeWrite(id = "e1") {
  return mockBatchSet.mock.calls.find((call) => call[0] === `edges/${id}`)?.[1];
}

function revisionWrite() {
  return mockBatchSet.mock.calls.find((call) =>
    String(call[0]).startsWith("revisions/"),
  )?.[1] as Record<string, unknown> | undefined;
}

function auditEntry() {
  return mockBatchSet.mock.calls.find((call) =>
    String(call[0]).startsWith("audit/"),
  )?.[1] as Record<string, unknown> | undefined;
}

/** A relation as `/api/edges/delete` leaves it. */
function removedEdge(extra: Record<string, unknown> = {}) {
  return {
    source: "a",
    target: "b",
    type: "employed",
    name: "Zarząd",
    deleted: true,
    delete_reason: "Błędnie scalona osoba",
    published: false,
    stats: { count: 3 },
    revision_id: { path: "revisions/removal" },
    ...extra,
  };
}

describe("api/edges/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    request({ edge_id: "e1" });
    stored["edges/e1"] = removedEdge();
  });

  it("takes the removal off the relation", async () => {
    const result = await handler({} as never);

    const write = edgeWrite();
    expect(write).toMatchObject({ source: "a", target: "b", name: "Zarząd" });
    expect(mockCommit).toHaveBeenCalled();
    expect(result).toMatchObject({ edge_id: "e1", restored: true });
  });

  it("leaves no `deleted` key at all rather than writing false", async () => {
    // The sharpest hazard here. Every reader tests `=== true` / `!== true`, so
    // `false` would look identical to them - but `applyRevision` layers the
    // stored value over the revision it is applying, so a document carrying
    // `deleted: false` would silently cancel the next approved removal.
    await handler({} as never);

    const write = edgeWrite() as Record<string, unknown>;
    expect("deleted" in write).toBe(false);
    expect("delete_reason" in write).toBe(false);
  });

  it("does not put the relation back on the public site", async () => {
    // The removal set `published: false` and the value it had before that is
    // recorded nowhere, so guessing would be the one way this could re-expose
    // something nobody reviewed. It comes back as a draft.
    const result = await handler({} as never);

    expect(edgeWrite()).toMatchObject({ published: false });
    expect(result.published).toBe(false);
  });

  it("repoints revision_id away from the removal revision", async () => {
    // Left where it was, re-approving it from /admin/rewizje would delete the
    // relation again, and /api/revisions/reject refuses to retire the revision
    // a document points at.
    const result = await handler({} as never);

    expect(revisionWrite()).toMatchObject({
      node_id: "e1",
      collection: "edges",
      status: "approved",
      update_user: "admin-uid",
    });
    expect(edgeWrite()).toMatchObject({
      revision_id: expect.objectContaining({ id: result.revision_id }),
    });
  });

  it("does not carry the removal's reason into the new revision", async () => {
    // The revision states the relation as it was and says nothing about the
    // removal - which is what retracting one looks like in a history somebody
    // reads back later.
    await handler({} as never);

    const data = revisionWrite()?.data as Record<string, unknown>;
    expect(data).toMatchObject({ source: "a", target: "b" });
    expect("delete_reason" in data).toBe(false);
    expect("deleted" in data).toBe(false);
  });

  it("keeps the counters the document owns", async () => {
    await handler({} as never);

    expect(edgeWrite()).toMatchObject({ stats: { count: 3 } });
  });

  it("files the restoration in the audit log, with no reason of its own", async () => {
    await handler({} as never);

    const entry = auditEntry() as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: "restore",
      collection: "edges",
      target_id: "e1",
      user: "admin-uid",
    });
    expect("reason" in entry).toBe(false);
  });

  it("clears the handler cache so the page draws it again", async () => {
    await handler({} as never);

    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("is idempotent on a relation that was never removed", async () => {
    stored["edges/e1"] = { source: "a", target: "b", published: true };

    const result = await handler({} as never);

    expect(result).toEqual({
      edge_id: "e1",
      restored: true,
      revision_id: null,
      published: true,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses an id that names no relation", async () => {
    stored = {};

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuses a caller who is not an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

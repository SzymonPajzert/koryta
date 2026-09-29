import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/delete.post";

const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

/** Sequential ids, so a test can name the revision the handler wrote. */
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

/** `where(field, "array-contains", value)` over the stored documents of one
 * collection - the only query this handler makes. */
function arrayContains(collection: string, field: string, value: unknown) {
  return {
    get: vi.fn(async () => ({
      docs: Object.entries(stored)
        .filter(
          ([path, data]) =>
            path.startsWith(`${collection}/`) &&
            Array.isArray(data?.[field]) &&
            (data[field] as unknown[]).includes(value),
        )
        .map(([path]) => ({ ref: { path } })),
    })),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
    where: vi.fn((field: string, _op: string, value: unknown) =>
      arrayContains(collection, field, value),
    ),
  })),
  batch: vi.fn(() => ({
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  // Only `now` is reached from here - `createRevisionTransaction` stamps the
  // revision with it and nothing in this path reads the value back.
  Timestamp: { now: () => ({}) },
  FieldValue: {
    delete: () => "deleted",
    arrayRemove: (...values: unknown[]) => ({ arrayRemove: values }),
  },
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

/** What the batch wrote to the edge document. */
function edgeWrite(id = "e1") {
  return mockBatchSet.mock.calls.find((call) => call[0] === `edges/${id}`)?.[1];
}

/** The revision the batch wrote, whatever id it was given. */
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

describe("api/edges/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    request({ edge_id: "e1", reason: "Błędnie scalona osoba" });
    stored["edges/e1"] = {
      source: "a",
      target: "b",
      type: "employed",
      published: true,
      stats: { count: 3 },
      revision_id: { path: "revisions/old" },
    };
  });

  it("marks the relation deleted and takes it off the site", async () => {
    const result = await handler({} as never);

    expect(edgeWrite()).toMatchObject({
      source: "a",
      target: "b",
      deleted: true,
      delete_reason: "Błędnie scalona osoba",
      published: false,
    });
    expect(mockCommit).toHaveBeenCalled();
    expect(result).toMatchObject({ edge_id: "e1", deleted: true });
  });

  it("records who removed it and why, as an approved revision", async () => {
    // The revision is the only account of a bad merge being cleared up, so it
    // has to carry the reason rather than just the flag - and it is approved as
    // it is written, because an admin removing a relation is the review of it.
    const result = await handler({} as never);

    expect(revisionWrite()).toMatchObject({
      node_id: "e1",
      collection: "edges",
      status: "approved",
      update_user: "admin-uid",
      review_user: "admin-uid",
      data: expect.objectContaining({
        deleted: true,
        delete_reason: "Błędnie scalona osoba",
      }),
    });
    expect(edgeWrite()).toMatchObject({
      revision_id: expect.objectContaining({ id: result.revision_id }),
    });
  });

  it("files the removal in the audit log", async () => {
    await handler({} as never);

    expect(auditEntry()).toMatchObject({
      action: "delete",
      collection: "edges",
      target_id: "e1",
      user: "admin-uid",
      reason: "Błędnie scalona osoba",
    });
  });

  it("keeps the counters the document owns", async () => {
    // The write is a `set`, so anything the revision does not carry is dropped
    // unless it is layered back on. Losing `stats` here would take the relation
    // out of every listing that filters on it.
    await handler({} as never);

    expect(edgeWrite()).toMatchObject({ stats: { count: 3 } });
  });

  it("does not let a stored `deleted: false` undo the removal", async () => {
    // `deleted` is a field the document owns, so it is layered back over the
    // revision. An edge written by the old client helper states it outright.
    stored["edges/e1"] = { source: "a", target: "b", deleted: false };

    await handler({} as never);

    expect(edgeWrite()).toMatchObject({ deleted: true });
  });

  it("takes the relation off every fact that was promoted into it", async () => {
    // Their cards say „Powiązanie utworzone” and point at „Historia
    // powiązań”, which stops being true now; they offer the promotion again.
    stored["extractions/f1"] = { promotedEdgeIds: ["e1", "e2"] };
    stored["extractions/f2"] = { promotedEdgeIds: ["e1"] };
    stored["extractions/f3"] = { promotedEdgeIds: ["e2"] };

    await handler({} as never);

    expect(mockBatchUpdate.mock.calls).toEqual([
      ["extractions/f1", { promotedEdgeIds: { arrayRemove: ["e1"] } }],
      ["extractions/f2", { promotedEdgeIds: { arrayRemove: ["e1"] } }],
    ]);
  });

  it("clears the handler cache so the page stops drawing it", async () => {
    await handler({} as never);

    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("is idempotent on a relation that is already gone", async () => {
    stored["edges/e1"] = { source: "a", target: "b", deleted: true };

    const result = await handler({} as never);

    expect(result).toEqual({
      edge_id: "e1",
      deleted: true,
      revision_id: null,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses an id that names no relation", async () => {
    stored = {};

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuses a removal with no reason", async () => {
    request({ edge_id: "e1", reason: "  " });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

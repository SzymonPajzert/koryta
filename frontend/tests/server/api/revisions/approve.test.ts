import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/revisions/approve.post";

const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockCommit = vi.fn();

/** Documents the fake Firestore holds, keyed by `<collection>/<id>`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => ({
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
  })),
  batch: vi.fn(() => ({
    set: mockBatchSet,
    update: mockBatchUpdate,
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "now" },
  FieldValue: { delete: () => "DELETED" },
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
  globalThis.useStorage = () => ({ clear: vi.fn() });
  return { mockReadValidatedBody };
});

/** The snapshot written onto the target document. */
function writtenTarget() {
  return mockBatchSet.mock.calls[0]![1];
}

/** The bookkeeping written back onto the revision. */
function writtenRevision() {
  return mockBatchUpdate.mock.calls[0]![1];
}

describe("api/revisions/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    mockReadValidatedBody.mockImplementation(async (_e, parse) =>
      parse({ revision_id: "rev-1" }),
    );
  });

  it("writes the revision's snapshot onto the node and points it there", async () => {
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Sylwia Sobolewska", type: "person" },
    };
    stored["nodes/node-1"] = { name: "Sylwia Sobolewski", type: "person" };

    const result = await handler({} as never);

    expect(writtenTarget()).toMatchObject({
      name: "Sylwia Sobolewska",
      type: "person",
      revision_id: expect.objectContaining({ id: "rev-1" }),
    });
    expect(writtenRevision()).toMatchObject({
      status: "approved",
      review_user: "admin-uid",
    });
    expect(result).toMatchObject({ id: "node-1", collection: "nodes" });
  });

  it("leaves a hidden page hidden", async () => {
    // Approving says what the page would show, not who may see it - otherwise
    // every accepted correction would silently publish a node an admin had
    // deliberately taken down.
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = { name: "Stara", published: false };

    const result = await handler({} as never);

    expect(writtenTarget().published).toBe(false);
    expect(result.published).toBe(false);
  });

  it("keeps a published page published", async () => {
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = { name: "Stara", published: true };

    await handler({} as never);

    expect(writtenTarget().published).toBe(true);
  });

  it("publishes in the same step when asked to", async () => {
    mockReadValidatedBody.mockImplementation(async (_e, parse) =>
      parse({ revision_id: "rev-1", publish: true }),
    );
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = { name: "Stara" };

    await handler({} as never);

    expect(writtenTarget().published).toBe(true);
  });

  it("carries over the counters the triggers maintain", async () => {
    // The write is a `set`, so anything the node owns rather than the revision
    // is dropped unless it is copied across by hand.
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = {
      name: "Stara",
      stats: { notesCount: 3 },
      votes: { interesting: { total: 2 } },
      nameChunksLower: ["n", "no"],
    };

    await handler({} as never);

    expect(writtenTarget()).toMatchObject({
      stats: { notesCount: 3 },
      votes: { interesting: { total: 2 } },
      nameChunksLower: ["n", "no"],
    });
  });

  it("applies an edge revision to the edges collection", async () => {
    // `node_id` holds the target's id whatever the target is, so without the
    // collection an edge revision would be written onto a node that does not
    // exist.
    stored["revisions/rev-1"] = {
      node_id: "edge-1",
      collection: "edges",
      data: { source: "a", target: "b", type: "employed" },
    };
    stored["edges/edge-1"] = { source: "a", target: "b", type: "employed" };

    const result = await handler({} as never);

    expect(result).toMatchObject({ id: "edge-1", collection: "edges" });
  });

  it("infers the collection for revisions written before it was recorded", async () => {
    stored["revisions/rev-1"] = {
      node_id: "edge-1",
      data: { source: "a", target: "b", type: "owns" },
    };
    stored["edges/edge-1"] = { source: "a", target: "b" };

    const result = await handler({} as never);

    expect(result.collection).toBe("edges");
  });

  it("refuses a revision that does not exist", async () => {
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

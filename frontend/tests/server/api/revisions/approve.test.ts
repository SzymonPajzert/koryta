import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import { notifyRevisionReviewed } from "../../../../server/utils/revisionNotifications";
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

/** The bulk read `resolveEdgeEndpoints` uses to fetch an edge's two nodes.
 *
 * Firestore has no join, so the endpoint check reads the nodes separately - and
 * it reads them with `getAll` rather than a `get` each, which is a different
 * entry point on the client than the rest of this fake serves.
 */
const mockGetAll = vi.fn(async (...refs: { id: string; path: string }[]) =>
  refs.map((ref) => ({
    id: ref.id,
    exists: stored[ref.path] !== undefined,
    data: () => stored[ref.path],
  })),
);

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => docRef(collection, id)),
  })),
  getAll: mockGetAll,
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

vi.mock("../../../../server/utils/revisionNotifications", () => ({
  notifyRevisionReviewed: vi.fn(async () => "sent"),
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

/** The audit entry, which shares the batch with the two writes above. */
function writtenAudit() {
  return mockBatchSet.mock.calls[1]![1];
}

/** Makes the next request approve `rev-1`, with whatever else it asks for. */
function requestApproval(extra: Record<string, unknown> = {}) {
  mockReadValidatedBody.mockImplementation(async (_e, parse) =>
    parse({ revision_id: "rev-1", ...extra }),
  );
}

/** A pending edge revision on `edge-1`, plus the edge it describes.
 *
 * The stored edge defaults to the revision's own data because that is the usual
 * case - the proposal changes a detail, not an end. Tests that check the moment
 * an end moves pass the two separately.
 */
function storeEdgeRevision(
  data: Record<string, unknown>,
  edge: Record<string, unknown> = data,
) {
  stored["revisions/rev-1"] = { node_id: "edge-1", collection: "edges", data };
  stored["edges/edge-1"] = edge;
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

  it("tells the author, and whether the page went live", async () => {
    // Approving does not publish, so "accepted" and "visible" are two different
    // answers and the message has to carry which one this was.
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Sylwia Sobolewska", type: "person" },
      update_user: "author-uid",
    };
    stored["nodes/node-1"] = { name: "Sylwia Sobolewski", published: false };

    await handler({} as never);

    expect(notifyRevisionReviewed).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        decision: "approved",
        published: false,
        revisionId: "rev-1",
        reviewerUid: "admin-uid",
      }),
    );
  });

  it("does not notify about an approval it refused to make", async () => {
    // The unpublished endpoint check throws before anything is written; a
    // message about a change that did not happen is worse than none.
    storeEdgeRevision({ source: "person-1", target: "place-1" });
    stored["nodes/person-1"] = { name: "Jan", published: false };
    stored["nodes/place-1"] = { name: "Firma", published: true };
    requestApproval({ publish: true });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(notifyRevisionReviewed).not.toHaveBeenCalled();
  });

  it("files who approved it, in the same batch as the approval", async () => {
    // `review_user` above holds only the latest verdict, so re-approving an
    // older version would erase who chose the newer one. The log does not.
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Sylwia Sobolewska" },
    };
    stored["nodes/node-1"] = { name: "Sylwia Sobolewski" };

    await handler({} as never);

    expect(writtenAudit()).toMatchObject({
      action: "approve",
      collection: "nodes",
      target_id: "node-1",
      revision_id: "rev-1",
      user: "admin-uid",
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
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

  it("files the publication it made as well as the approval", async () => {
    // Otherwise "zatwierdź i opublikuj" puts a page live that the publication
    // count and /aktywnosc, which read only `publish` rows, never see.
    requestApproval({ publish: true });
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = { name: "Stara" };

    await handler({} as never);

    expect(writtenAudit()).toMatchObject({ action: "approve" });
    expect(mockBatchSet.mock.calls[2]![1]).toMatchObject({
      action: "publish",
      collection: "nodes",
      target_id: "node-1",
      revision_id: "rev-1",
      user: "admin-uid",
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it("approves a removal as a removal, even when asked to publish", async () => {
    // The queue offered "Zatwierdź i opublikuj" on removals too, and the page
    // it deleted then showed as published on /aktywnosc and in the statistics.
    requestApproval({ publish: true });
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Stara", deleted: true, delete_reason: "duplikat" },
    };
    stored["nodes/node-1"] = { name: "Stara", published: false };

    const result = await handler({} as never);

    expect(writtenTarget()).toMatchObject({ deleted: true, published: false });
    expect(result.published).toBe(false);
    expect(writtenAudit()).toMatchObject({ action: "approve" });
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
  });

  it("files no publication for a page that was already live", async () => {
    requestApproval({ publish: true });
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Nowa" },
    };
    stored["nodes/node-1"] = { name: "Stara", published: true };

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
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

  describe("keeping a relation inside its endpoints", () => {
    // A relation is a claim about two pages, so showing it shows something
    // about both. Approving is one of the two ways an edge can end up live -
    // the reviewer asks for it, or the edge was already live and the snapshot
    // carries that across - and both have to answer to the rule.

    it("refuses to publish a relation whose source page is still a draft", async () => {
      // The message names the page that is holding it back, which is the
      // difference between fixing it in one step and hunting for which end of
      // the relation is missing.
      storeEdgeRevision({ source: "node-a", target: "node-b" });
      stored["nodes/node-a"] = { name: "Anna Nowak" };
      stored["nodes/node-b"] = { name: "Bogdan Lis", published: true };
      requestApproval({ publish: true });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Anna Nowak"),
      });
      // Refused before anything is written, so there is no half-approved
      // revision left pointing at a relation nobody may see.
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("refuses to publish a relation whose target page is still a draft", async () => {
      storeEdgeRevision({ source: "node-a", target: "node-b" });
      stored["nodes/node-a"] = { name: "Anna Nowak", published: true };
      stored["nodes/node-b"] = { name: "Bogdan Lis" };
      requestApproval({ publish: true });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Bogdan Lis"),
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("names both pages when neither of them is live", async () => {
      storeEdgeRevision({ source: "node-a", target: "node-b" });
      stored["nodes/node-a"] = { name: "Anna Nowak" };
      stored["nodes/node-b"] = { name: "Bogdan Lis" };
      requestApproval({ publish: true });

      await expect(handler({} as never)).rejects.toMatchObject({
        message: expect.stringMatching(/Anna Nowak.*Bogdan Lis/),
      });
    });

    it("publishes a relation whose two pages are both live", async () => {
      storeEdgeRevision({ source: "node-a", target: "node-b" });
      stored["nodes/node-a"] = { name: "Anna Nowak", published: true };
      stored["nodes/node-b"] = { name: "Bogdan Lis", published: true };
      requestApproval({ publish: true });

      const result = await handler({} as never);

      expect(writtenTarget().published).toBe(true);
      expect(result).toMatchObject({ id: "edge-1", published: true });
    });

    it("refuses to approve a live relation whose page has since been hidden", async () => {
      // Nothing here asks to publish, but applying a revision carries the
      // target's own `published` across, so approving would leave the relation
      // up while one of its ends is a draft again.
      storeEdgeRevision(
        { source: "node-a", target: "node-b", type: "employed" },
        {
          source: "node-a",
          target: "node-b",
          type: "employed",
          published: true,
        },
      );
      stored["nodes/node-a"] = { name: "Anna Nowak", published: true };
      stored["nodes/node-b"] = { name: "Bogdan Lis", published: false };

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Bogdan Lis"),
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("approves a hidden relation whatever state its pages are in", async () => {
      // Approving says what the relation claims, not who may see it. A hidden
      // edge shows nobody anything, so its endpoints have no say in whether the
      // correction is accepted - refusing here would strand every proposal on a
      // relation between two drafts.
      storeEdgeRevision({ source: "node-a", target: "node-b", type: "owns" });
      stored["nodes/node-a"] = { name: "Anna Nowak" };
      stored["nodes/node-b"] = { name: "Bogdan Lis" };

      const result = await handler({} as never);

      expect(writtenTarget()).toMatchObject({ type: "owns", published: false });
      expect(result.published).toBe(false);
    });

    it("lets an admin hide a relation and accept its revision in one step", async () => {
      // `publish: false` is the reviewer taking the relation down, so the rule
      // it would otherwise break is not in play.
      storeEdgeRevision(
        { source: "node-a", target: "node-b" },
        { source: "node-a", target: "node-b", published: true },
      );
      stored["nodes/node-a"] = { name: "Anna Nowak" };
      stored["nodes/node-b"] = { name: "Bogdan Lis" };
      requestApproval({ publish: false });

      const result = await handler({} as never);

      expect(writtenTarget().published).toBe(false);
      expect(result.published).toBe(false);
    });

    it("refuses a revision that moves a live relation onto a hidden page", async () => {
      // The revision is itself what breaks the rule: both stored ends are live,
      // and only the snapshot about to be written points at a draft. Checking
      // what is stored rather than what is being written would let this one
      // through.
      storeEdgeRevision(
        { source: "node-a", target: "node-c" },
        { source: "node-a", target: "node-b", published: true },
      );
      stored["nodes/node-a"] = { name: "Anna Nowak", published: true };
      stored["nodes/node-b"] = { name: "Bogdan Lis", published: true };
      stored["nodes/node-c"] = { name: "Celina Mak" };

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Celina Mak"),
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("never subjects a node revision to the check", async () => {
      // A node has no endpoints, so there is nothing to read and nothing that
      // could refuse it - publishing a page is decided by /api/nodes/publish.
      stored["revisions/rev-1"] = {
        node_id: "node-1",
        collection: "nodes",
        data: { name: "Anna Nowak" },
      };
      stored["nodes/node-1"] = { name: "Anna Nowak" };
      requestApproval({ publish: true });

      const result = await handler({} as never);

      expect(result.published).toBe(true);
      expect(mockGetAll).not.toHaveBeenCalled();
    });
  });
});

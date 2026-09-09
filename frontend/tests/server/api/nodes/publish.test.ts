import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import { notifyRevisionReviewed } from "../../../../server/utils/revisionNotifications";
import handler from "../../../../server/api/nodes/publish.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();

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

/** Every document of one collection, for the equality queries the cascade
 * runs. `stored` is keyed by path, which is what the rest of the fake reads. */
function queryCollection(
  collection: string,
  field: string,
  value: unknown,
): { id: string; data: () => Record<string, unknown> }[] {
  return Object.entries(stored)
    .filter(([path]) => path.startsWith(`${collection}/`))
    .filter(([, data]) => data?.[field] === value)
    .map(([path, data]) => ({
      id: path.slice(collection.length + 1),
      data: () => data as Record<string, unknown>,
    }));
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
    where: vi.fn((field: string, _op: string, value: unknown) => ({
      get: vi.fn(async () => {
        const docs = queryCollection(collection, field, value);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }),
    })),
  })),
  batch: vi.fn(() => ({
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
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

const { mockReadValidatedBody, mockCacheClear } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  const mockCacheClear = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.useStorage = () => ({ clear: mockCacheClear });
  globalThis.useRuntimeConfig = () => ({
    public: { siteUrl: "https://koryta.pl" },
  });
  return { mockReadValidatedBody, mockCacheClear };
});

/** Makes the next request ask for `published` on node-1. */
function requestPublished(published: boolean) {
  mockReadValidatedBody.mockImplementation(async (_e, parse) =>
    parse({ node_id: "node-1", published }),
  );
}

describe("api/nodes/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    requestPublished(true);
  });

  it("drops the cached pages that were rendered without this one", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    await handler({} as never);

    // Every cached handler counts published nodes, so until this runs the
    // explore and stats endpoints answer from before the page existed. The
    // relations and revisions endpoints have always cleared; this one is the
    // path taken when the reviewer ticks no relations at all, and it used to
    // leave the site six hours behind with nothing able to nudge it.
    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("drops them when hiding a page too", async () => {
    stored["nodes/node-1"] = { name: "X", published: true };
    requestPublished(false);

    await handler({} as never);

    // A page taken down has to leave the cached lists as surely as one put up.
    expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
  });

  it("publishes a node that has an approved revision", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledWith("nodes/node-1", {
      published: true,
    });
    expect(mockCommit).toHaveBeenCalled();
    expect(result).toEqual({
      id: "node-1",
      published: true,
      hiddenEdges: [],
      approvedRevisionId: null,
    });
  });

  it("files who published it, in the same commit as the change", async () => {
    // The node keeps only the answer. Without the log there is nothing to read
    // back when two admins disagree about whether a page should be live.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        action: "publish",
        collection: "nodes",
        target_id: "node-1",
        user: "admin-uid",
      }),
    );
    // One batch, so a node cannot end up published with nobody named for it
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it("records hiding a page as its own action", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    requestPublished(false);

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({ action: "unpublish", user: "admin-uid" }),
    );
  });

  it("stamps the entry with a time", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    await handler({} as never);

    const entry = mockBatchSet.mock.calls[0]?.[1] as { at: string };
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  it("refuses to hide a node that does not exist", async () => {
    requestPublished(false);

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses to publish a page with no revision at all", async () => {
    // A node is a materialised copy of a revision, so one with none has no
    // snapshot to serve and nothing publishing could approve on the way.
    stored["nodes/node-1"] = { name: "X" };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses when every revision the page has is unusable", async () => {
    stored["nodes/node-1"] = { name: "X" };
    stored["revisions/rev-rejected"] = {
      node_id: "node-1",
      status: "rejected",
      data: { name: "X" },
      update_time: "2026-07-09T10:00:00Z",
    };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("approves the newest revision for a page that has none approved", async () => {
    // The refusal used to end here, and most pages are in this state: the
    // ingests write a snapshot and nobody ever approves one by hand, so the
    // reviewer who opened the page and clicked "Opublikuj" had no way forward
    // from that screen. Publishing means showing what the page says now.
    stored["nodes/node-1"] = { name: "X" };
    stored["revisions/rev-old"] = {
      node_id: "node-1",
      data: { name: "Stara wersja" },
      update_time: "2026-07-09T10:00:00Z",
    };
    stored["revisions/rev-new"] = {
      node_id: "node-1",
      data: { name: "Nowa wersja" },
      update_time: "2026-07-09T12:00:00Z",
    };

    const result = await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "nodes/node-1",
      expect.objectContaining({ name: "Nowa wersja" }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      "revisions/rev-new",
      expect.objectContaining({ status: "approved", review_user: "admin-uid" }),
    );
    expect(mockBatchUpdate).toHaveBeenCalledWith("nodes/node-1", {
      published: true,
    });
    expect(result).toMatchObject({
      published: true,
      approvedRevisionId: "rev-new",
    });
  });

  it("approves before it publishes, so a live page always points at something", async () => {
    stored["nodes/node-1"] = { name: "X" };
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      data: { name: "X" },
      update_time: "2026-07-09T10:00:00Z",
    };

    await handler({} as never);

    // Two commits, in this order: the failure mode of the other order is a
    // page readers can open that points at no approved version.
    expect(mockCommit).toHaveBeenCalledTimes(2);
    const setPaths = mockBatchSet.mock.calls.map((call) => call[0]);
    expect(setPaths[0]).toBe("nodes/node-1");
  });

  it("tells the author their suggestion went live", async () => {
    // The same message `/api/revisions/approve` sends. Somebody whose proposal
    // is approved this way is owed it as much as one approved from the queue.
    stored["nodes/node-1"] = { name: "X" };
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      data: { name: "X" },
      update_user: "author-uid",
      update_time: "2026-07-09T10:00:00Z",
    };

    await handler({} as never);

    expect(notifyRevisionReviewed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: "approved",
        revisionId: "rev-1",
        published: true,
        reviewerUid: "admin-uid",
      }),
    );
  });

  it("leaves an approved page's revision alone", async () => {
    // Approving the newest is the fallback for a page with no answer, never a
    // silent overwrite of the version an admin chose on purpose.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["revisions/rev-newer"] = {
      node_id: "node-1",
      data: { name: "Nowsza" },
      update_time: "2026-07-09T12:00:00Z",
    };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledWith("nodes/node-1", {
      published: true,
    });
    expect(result).toMatchObject({ approvedRevisionId: null });
  });

  it("approves nothing when the page is being hidden", async () => {
    stored["nodes/node-1"] = { name: "X", published: true };
    stored["revisions/rev-1"] = {
      node_id: "node-1",
      data: { name: "X" },
      update_time: "2026-07-09T10:00:00Z",
    };
    requestPublished(false);

    const result = await handler({} as never);

    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "revisions/rev-1",
      expect.anything(),
    );
    expect(result).toMatchObject({ approvedRevisionId: null });
  });

  it("takes the page's published relations down with it", async () => {
    // No edge may be live unless both its pages are, so hiding one of them has
    // to hide the relations that lean on it - otherwise republishing the page
    // months later brings back claims nobody looked at again.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      published: true,
    };
    requestPublished(false);

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledWith("edges/e-out", {
      published: false,
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith("edges/e-in", {
      published: false,
    });
    expect(result).toMatchObject({
      published: false,
      hiddenEdges: expect.arrayContaining(["e-out", "e-in"]),
    });
  });

  it("hides the relations before the page, so the rule holds throughout", async () => {
    // Either order ends in the same place, but only this one has no moment
    // where a published edge hangs off a hidden page.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    requestPublished(false);

    await handler({} as never);

    const paths = mockBatchUpdate.mock.calls.map((call) => call[0]);
    expect(paths.indexOf("edges/e-1")).toBeLessThan(
      paths.indexOf("nodes/node-1"),
    );
  });

  it("leaves relations that were already hidden alone", async () => {
    // Rewriting them would cost a write and fire onEdgeWritten for nothing.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-hidden"] = { source: "node-1", target: "node-2" };
    stored["edges/e-false"] = {
      source: "node-1",
      target: "node-2",
      published: false,
    };
    requestPublished(false);

    const result = await handler({} as never);

    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "edges/e-hidden",
      expect.anything(),
    );
    expect(result).toMatchObject({ hiddenEdges: [] });
  });

  it("does not touch relations when a page goes live", async () => {
    // Publishing a node says nothing about the relations hanging off it; those
    // are chosen one by one in the dialog.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = { source: "node-1", target: "node-2" };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ hiddenEdges: [] });
  });

  it("files each hidden relation in the audit log", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    requestPublished(false);

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        action: "unpublish",
        collection: "edges",
        target_id: "e-1",
        user: "admin-uid",
      }),
    );
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});

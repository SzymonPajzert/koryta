import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/edges/byNode.get";

let stored: Record<string, Record<string, unknown> | undefined> = {};

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

/** Every document of one collection matching an equality filter. `stored` is
 * keyed by path, which is what the rest of the fake reads. */
function queryCollection(
  collection: string,
  field: string,
  op: string,
  value: unknown,
): { id: string; data: () => Record<string, unknown> }[] {
  return Object.entries(stored)
    .filter(([path]) => path.startsWith(`${collection}/`))
    .filter(([, data]) =>
      op === "in"
        ? (value as unknown[]).includes(data?.[field])
        : data?.[field] === value,
    )
    .map(([path, data]) => ({
      id: path.slice(collection.length + 1),
      data: () => data as Record<string, unknown>,
    }));
}

/** Records which collection each equality query went to, so a test can say
 * that a query was never run at all. */
const mockWhere = vi.fn();

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
    where: vi.fn((field: string, op: string, value: unknown) => {
      mockWhere(collection, field, value);
      return {
        get: vi.fn(async () => {
          const docs = queryCollection(collection, field, op, value);
          return { docs, size: docs.length, empty: docs.length === 0 };
        }),
      };
    }),
  })),
  // The endpoint fetch reads every node an edge touches in one call, so the
  // fake has to answer a multi-get rather than a per-document `get`.
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
  // `revisionTime` narrows `update_time` with `instanceof Timestamp`, so the
  // mocked module still has to export something constructible.
  Timestamp: class {
    toMillis() {
      return 0;
    }
    static now() {
      return new this();
    }
  },
  FieldValue: { delete: () => "delete" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

/** Makes the next request carry `query`.
 *
 * Nitro validates the query string before the handler body runs and answers
 * 400 itself when the schema rejects it, so the stub turns a schema failure
 * into that same 400 instead of letting the ZodError escape as a 500.
 */
function request(query: Record<string, unknown>) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

type Relation = {
  id: string;
  direction: "outgoing" | "incoming";
  otherId: string;
  otherName: string | null;
  otherPublished: boolean;
  published: boolean;
  hasPendingRevision: boolean;
  publishable: boolean;
};

type Result = { relations: Relation[]; nodePublished: boolean };

const callHandler = () =>
  (handler as unknown as (event: unknown) => Promise<Result>)({});

/** The returned relations by id, for the assertions that do not care about
 * the order they came back in. */
function byId(result: Result): Record<string, Relation> {
  return Object.fromEntries(result.relations.map((r) => [r.id, r]));
}

/** A published node, which is the uninteresting end of most of these edges. */
function publishedNode(name: string) {
  return { name, published: true };
}

/** A job of node-1's, as the edge and the revision that wrote it both say. */
const employment = { source: "node-1", target: "node-2", type: "employed" };

describe("api/edges/byNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    stored["nodes/node-1"] = publishedNode("Jan Kowalski");
    request({ nodeId: "node-1" });
  });

  it("returns the relations the node points at and the ones pointing at it", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["nodes/node-3"] = publishedNode("Firma B");
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      type: "mentions",
    };

    const relations = byId(await callHandler());

    expect(Object.keys(relations).sort()).toEqual(["e-in", "e-out"]);
    expect(relations["e-out"]?.direction).toBe("outgoing");
    expect(relations["e-in"]?.direction).toBe("incoming");
  });

  it("describes the other end of the relation, whichever end that is", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["nodes/node-3"] = publishedNode("Gazeta");
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      type: "mentions",
    };

    const relations = byId(await callHandler());

    expect(relations["e-out"]).toMatchObject({
      otherId: "node-2",
      otherName: "Firma A",
      otherPublished: true,
    });
    expect(relations["e-in"]).toMatchObject({
      otherId: "node-3",
      otherName: "Gazeta",
      otherPublished: true,
    });
  });

  it("blocks a relation whose other end is still a draft", async () => {
    // The row is greyed out on this flag alone: publishing an edge into a page
    // nobody can open is the thing the invariant exists to prevent.
    stored["nodes/node-2"] = { name: "Szkic", published: false };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      otherPublished: false,
      publishable: false,
    });
  });

  it("blocks a relation whose other end does not exist at all", async () => {
    // A dangling edge is worse than one pointing at a draft, so the missing
    // document has to read as unpublished rather than as unknown.
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-missing",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      otherId: "node-missing",
      otherName: null,
      otherPublished: false,
      publishable: false,
    });
  });

  it("reports whether each relation is itself on the site", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-live"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["edges/e-draft"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
      published: false,
    };

    const relations = byId(await callHandler());

    expect(relations["e-live"]?.published).toBe(true);
    expect(relations["e-draft"]?.published).toBe(false);
  });

  it("flags an unpublished relation that still has a proposal waiting", async () => {
    // The dialog says so - which it can only do if the handler looked the
    // proposal up.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(true);
  });

  it("does not flag a relation whose proposals have all been answered", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "rejected" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
  });

  it("does not flag a relation that already points at an approved proposal", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: false,
      revision_id: { path: "revisions/rev-approved" },
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
  });

  it("does not go looking for proposals on a relation that is already live", async () => {
    // One revisions query per row is an N+1 the dialog cannot afford, and a
    // published edge has nothing outstanding for a reviewer to decide anyway.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["revisions/rev-1"] = { node_id: "e-1", status: "pending" };

    const relations = byId(await callHandler());

    expect(relations["e-1"]?.hasPendingRevision).toBe(false);
    expect(mockWhere).not.toHaveBeenCalledWith(
      "revisions",
      "node_id",
      expect.anything(),
    );
  });

  it("leaves out relations that were removed", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-gone"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      deleted: true,
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-1"]);
  });

  it("lists a relation from the node to itself once", async () => {
    // Both the source and the target query return it, and a reviewer seeing
    // the same row twice would tick it twice.
    stored["edges/e-self"] = {
      source: "node-1",
      target: "node-1",
      type: "connection",
    };

    const result = await callHandler();

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      id: "e-self",
      direction: "outgoing",
      otherId: "node-1",
      publishable: true,
    });
  });

  it("puts the relations that are not yet live first", async () => {
    // The dialog is a work queue, so what still needs a decision goes on top.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-live"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      published: true,
    };
    stored["edges/e-draft"] = {
      source: "node-1",
      target: "node-2",
      type: "owns",
      published: false,
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-draft", "e-live"]);
  });

  it("puts the relations that can be published before the ones blocked on a draft", async () => {
    // Alphabetically the blocked one would come first, so the order proves the
    // rule rather than the tie-break that follows it.
    stored["nodes/node-blocked"] = { name: "Alfa", published: false };
    stored["nodes/node-ready"] = publishedNode("Zeta");
    stored["edges/e-blocked"] = {
      source: "node-1",
      target: "node-blocked",
      type: "employed",
    };
    stored["edges/e-ready"] = {
      source: "node-1",
      target: "node-ready",
      type: "owns",
    };

    const result = await callHandler();

    expect(result.relations.map((r) => r.id)).toEqual(["e-ready", "e-blocked"]);
  });

  it("reports whether the node itself is published", async () => {
    stored["nodes/node-1"] = { name: "Jan Kowalski", published: false };

    expect((await callHandler()).nodePublished).toBe(false);

    stored["nodes/node-1"] = publishedNode("Jan Kowalski");

    expect((await callHandler()).nodePublished).toBe(true);
  });

  it("reports a node that does not exist as unpublished", async () => {
    stored = {};

    const result = await callHandler();

    expect(result).toEqual({ relations: [], nodePublished: false });
  });

  it("is refused to everyone but an admin", async () => {
    // Which pages are still drafts is not something an anonymous caller has
    // any business enumerating.
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("names the revision publishing would approve, whatever its status", async () => {
    // What the reviewer needs to know is which version goes live, not whether
    // somebody happened to stamp it "pending". Reporting every unpointed
    // relation as a proposal awaiting a verdict said the same thing about all
    // of them and was wrong about most.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = { ...employment };
    stored["revisions/rev-1"] = {
      node_id: "e-1",
      status: "approved",
      update_time: "2026-01-01T00:00:00.000Z",
      data: employment,
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: "rev-1",
      hasPendingRevision: false,
    });
  });

  it("still says so when a revision really is awaiting a verdict", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = { ...employment };
    stored["revisions/rev-1"] = {
      node_id: "e-1",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: employment,
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: "rev-1",
      hasPendingRevision: true,
    });
  });

  it("never offers to approve a proposal the relation does not hold", async () => {
    // Publishing leaves such a proposal waiting, so the dialog must not say
    // the newest revision will be approved: it is still waiting afterwards.
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "election",
      start_date: "2024-01-01",
    };
    stored["revisions/proposal_e-1_x"] = {
      node_id: "e-1",
      status: "pending",
      update_time: "2026-09-01T00:00:00.000Z",
      data: {
        source: "node-1",
        target: "node-2",
        type: "election",
        start_date: "2024-01-01",
        committee: "KWW Nasza Gmina",
      },
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: null,
      hasPendingRevision: true,
    });
  });

  it("has nothing to approve for a relation with no revision at all", async () => {
    stored["nodes/node-2"] = publishedNode("Firma A");
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      type: "employed",
    };

    const relations = byId(await callHandler());

    expect(relations["e-1"]).toMatchObject({
      revisionToApprove: null,
      hasPendingRevision: false,
    });
  });

  it("reads revisions for the whole batch rather than one relation at a time", async () => {
    // A node with fifty relations would otherwise cost fifty round trips just
    // to render the dialog.
    stored["nodes/node-2"] = publishedNode("Firma A");
    for (let i = 0; i < 5; i += 1) {
      stored[`edges/e-${i}`] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };
    }

    await callHandler();

    const revisionQueries = mockWhere.mock.calls.filter(
      (call) => call[0] === "revisions",
    );
    expect(revisionQueries).toHaveLength(1);
  });

  it("refuses a request that names no node", async () => {
    request({});

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 400 });
  });

  describe("when the page itself is still a draft", () => {
    // The case the dialog is actually opened in. Judging a relation by the
    // whole both-ends-published rule here greys out every row, including the
    // ones that are about to become perfectly publishable, because the page
    // being published is one of the two ends and has not gone live yet.
    beforeEach(() => {
      stored["nodes/node-1"] = { name: "Jan Kowalski", published: false };
    });

    it("offers a relation whose other end is already live", async () => {
      stored["nodes/node-2"] = publishedNode("Firma A");
      stored["edges/e-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };

      const relations = byId(await callHandler());

      expect(relations["e-1"]).toMatchObject({
        otherPublished: true,
        publishable: true,
      });
    });

    it("still blocks a relation whose other end is a draft too", async () => {
      stored["nodes/node-2"] = { name: "Szkic", published: false };
      stored["edges/e-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
      };

      const relations = byId(await callHandler());

      expect(relations["e-1"]).toMatchObject({ publishable: false });
    });

    it("treats a self-edge as having nothing standing in its way", async () => {
      // Both ends are the page being published, so there is no far end to wait
      // on. Degenerate, but it must not read as blocked by itself.
      stored["edges/e-self"] = {
        source: "node-1",
        target: "node-1",
        type: "connection",
      };

      const relations = byId(await callHandler());

      expect(relations["e-self"]).toMatchObject({ publishable: true });
    });

    it("reports the page as the draft it is", async () => {
      const result = await callHandler();

      expect(result.nodePublished).toBe(false);
    });
  });
});

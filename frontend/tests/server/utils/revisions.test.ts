import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyRevision,
  getRevisionsForNodes,
  createRevisionTransaction,
  INTERNAL_FIELDS,
  proposalId,
  proposeRevisionTransaction,
  revisionChangesNothing,
  sameStoredValue,
  sanitizeFirestoreData,
  withoutInternalFields,
} from "../../../server/utils/revisions";
import { skippedChangeFields } from "../../../shared/revisionChanges";
import type {
  Firestore,
  WriteBatch,
  DocumentReference,
} from "firebase-admin/firestore";

vi.mock("firebase-admin/firestore", () => {
  return {
    Timestamp: {
      now: vi.fn(() => ({ toMillis: () => 1234567890 })),
    },
    FieldValue: { delete: vi.fn(() => "<delete>") },
    // the rest are types and don't need mocking at runtime
  };
});

// Mock Firestore
const mockGet = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockCollection = vi.fn().mockReturnValue({
  where: mockWhere,
  get: mockGet,
  doc: vi.fn(),
});
const mockBatch = {
  set: vi.fn(),
} as unknown as WriteBatch;

const mockDb = {
  collection: mockCollection,
  batch: vi.fn().mockReturnValue(mockBatch),
} as unknown as Firestore;

describe("sanitizeFirestoreData", () => {
  it("keeps a top-level array field an array", () => {
    // The whole point: `parties` is queried with array-contains-any, which
    // matches nothing against a map and does not raise.
    expect(sanitizeFirestoreData({ parties: ["PiS", "PSL"] })).toEqual({
      parties: ["PiS", "PSL"],
    });
  });

  it("keeps an empty array an array", () => {
    // `{}` would not match the "no party" filter either, which looks for
    // `parties == []`.
    expect(sanitizeFirestoreData({ parties: [] })).toEqual({ parties: [] });
  });

  it("keeps arrays nested inside objects arrays", () => {
    expect(sanitizeFirestoreData({ note: { sources: ["a", "b"] } })).toEqual({
      note: { sources: ["a", "b"] },
    });
  });

  it("rewrites an array directly inside an array as a map", () => {
    // Firestore has no array-of-arrays, so this one really cannot be stored.
    expect(sanitizeFirestoreData({ grid: [["a", "b"], ["c"]] })).toEqual({
      grid: [{ 0: "a", 1: "b" }, { 0: "c" }],
    });
  });

  it("keeps an array of objects, including their own arrays", () => {
    expect(
      sanitizeFirestoreData({
        sources: [{ url: "u", tags: ["x"] }],
      }),
    ).toEqual({ sources: [{ url: "u", tags: ["x"] }] });
  });

  it("drops undefined and null fields", () => {
    expect(sanitizeFirestoreData({ a: 1, b: undefined, c: null })).toEqual({
      a: 1,
    });
  });

  it("drops undefined and null array elements rather than leaving holes", () => {
    // Firestore rejects an undefined element outright.
    expect(sanitizeFirestoreData({ tags: ["a", null, "b"] })).toEqual({
      tags: ["a", "b"],
    });
  });

  it("leaves primitives alone", () => {
    expect(sanitizeFirestoreData({ n: 1, s: "x", b: false })).toEqual({
      n: 1,
      s: "x",
      b: false,
    });
  });

  // A Firestore value type is an object, but it is a value: taken apart into
  // its private fields it becomes a map, and a map is not a timestamp to sort
  // on, not a reference to follow, and not a `toDate()` anybody can call. Every
  // article node written through `ensureArticleNode` carried a `publishedDate`
  // decomposed this way. Told apart by prototype, so this covers the whole
  // family rather than the three the SDK happens to export today.
  class FakeTimestamp {
    constructor(
      readonly _seconds: number,
      readonly _nanoseconds: number,
    ) {}
    toDate() {
      return new Date(this._seconds * 1000);
    }
  }

  it("keeps a Firestore value type whole rather than storing its fields", () => {
    const stamp = new FakeTimestamp(1_700_000_000, 0);
    const result = sanitizeFirestoreData({ publishedDate: stamp }) as {
      publishedDate: FakeTimestamp;
    };
    expect(result.publishedDate).toBe(stamp);
    expect(result.publishedDate).toBeInstanceOf(FakeTimestamp);
  });

  it("keeps one nested inside an object and inside an array", () => {
    const stamp = new FakeTimestamp(1_700_000_000, 0);
    const result = sanitizeFirestoreData({
      meta: { fetchedAt: stamp },
      spells: [{ start: stamp }],
    }) as {
      meta: { fetchedAt: FakeTimestamp };
      spells: { start: FakeTimestamp }[];
    };
    expect(result.meta.fetchedAt).toBe(stamp);
    expect(result.spells[0]!.start).toBe(stamp);
  });

  it("still descends into a plain object that merely looks like one", () => {
    // The guard is about the prototype, not the field names - a map that came
    // off `doc.data()` with these keys is still a map to sanitize.
    expect(
      sanitizeFirestoreData({
        publishedDate: { _seconds: 1, _nanoseconds: 2, gone: undefined },
      }),
    ).toEqual({ publishedDate: { _seconds: 1, _nanoseconds: 2 } });
  });
});

/** A stand-in for a Firestore document reference. `parent` is what says which
 * collection the document is in, and the revision records it. */
function targetRefIn(collection: string, id: string) {
  return { id, parent: { id: collection } } as DocumentReference;
}

const nodeRef = (id: string) => targetRefIn("nodes", id);

describe("createRevisionTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
  });

  it("should create a revision and NOT update head when updateHead=false", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(mockDb, mockBatch, user, targetRef, data);

    // Should create revision
    expect(mockCollection).toHaveBeenCalledWith("revisions");
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    // Verify first call is setting revision
    const firstCallArgs = vi.mocked(mockBatch.set).mock.calls[0];
    expect(firstCallArgs[1]).toMatchObject({
      node_id: "node-1",
      data: data,
      update_user: "test-user",
    });
    // Without approve/published the target document is the data, plus the
    // counters every node has to carry to be found at all - see
    // `withSeededNodeStats`.
    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1];
    expect(targetData).toEqual({
      ...data,
      stats: { nodeGroupSize: 0, isApproved: false },
    });
  });

  it("should set revision_id on the target but not in the revision data when approving", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(mockDb, mockBatch, user, targetRef, data, {
      approve: true,
    });

    const revisionDoc = vi.mocked(mockBatch.set).mock.calls[0][1] as {
      data: Record<string, unknown>;
    };
    expect(revisionDoc.data).not.toHaveProperty("revision_id");

    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(targetData.revision_id).toEqual({ id: "new-rev-id" });
  });

  it("should write the published flag onto the target document", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(mockDb, mockBatch, user, targetRef, data, {
      approve: true,
      published: false,
    });

    const revisionDoc = vi.mocked(mockBatch.set).mock.calls[0][1] as {
      data: Record<string, unknown>;
    };
    expect(revisionDoc.data).not.toHaveProperty("published");

    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(targetData.published).toBe(false);
  });

  it("records which collection the revision is for", () => {
    // `node_id` holds the target's id whether the target is a node or an edge,
    // so without this a reviewer applying an edge revision writes it onto a
    // node that does not exist.
    const user = { uid: "test-user" };
    const data = { source: "node-1", target: "node-2", type: "employed" };

    createRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      targetRefIn("edges", "edge-1"),
      data,
    );

    expect(vi.mocked(mockBatch.set).mock.calls[0][1]).toMatchObject({
      node_id: "edge-1",
      collection: "edges",
    });
    // `stats.nodeGroupSize` is a node's search ranking; an edge has no name to
    // be found by and nothing reads a counter on one.
    expect(vi.mocked(mockBatch.set).mock.calls[1][1]).not.toHaveProperty(
      "stats",
    );
  });

  describe("updating a document that already exists", () => {
    /** A published person as the export has them: the data a revision states,
     * and the fields the node owns and no revision carries. */
    const stored = {
      name: "Krystian Probierz",
      type: "person",
      published: true,
      revision_id: { id: "old-rev" },
      votes: { interesting: 3 },
      nameChunksLower: ["k", "kr"],
      stats: {
        isApproved: true,
        notesCount: 2,
        nodeGroupSize: 4,
        edges: { all: {}, approved: {} },
      },
    };

    /** What `set` was told to write to the node. */
    function targetWrite(
      options: Parameters<typeof createRevisionTransaction>[5],
    ) {
      createRevisionTransaction(
        mockDb,
        mockBatch,
        { uid: "test-user" },
        nodeRef("node-1"),
        { name: "Krystian Probierz", type: "person", parties: ["PiS"] },
        options,
      );
      return vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
        string,
        unknown
      >;
    }

    it("keeps the stats the listings filter on", () => {
      // `/api/nodes` filters on `stats.isApproved == true`, and a Firestore
      // equality filter does not match a document that lacks the field at all -
      // so dropping this took a re-ingested person out of every listing while
      // leaving their page up.
      expect(targetWrite({ approve: true, stored }).stats).toEqual(
        stored.stats,
      );
    });

    it("keeps the votes cast on the document", () => {
      expect(targetWrite({ approve: true, stored }).votes).toEqual(
        stored.votes,
      );
    });

    it("keeps the page's visibility without being told it", () => {
      // The caller says what changed, not who may see it.
      expect(targetWrite({ approve: true, stored }).published).toBe(true);
    });

    it("lets the caller override the stored visibility", () => {
      // Publishing or hiding a document is exactly this decision.
      expect(
        targetWrite({ approve: true, stored, published: false }).published,
      ).toBe(false);
    });

    it("does not let a revision restore a stale count over the live one", () => {
      // Revisions written before the internal fields were stripped out carry a
      // snapshot of them. The document owns those fields; the revision does not
      // get to speak for them.
      createRevisionTransaction(
        mockDb,
        mockBatch,
        { uid: "test-user" },
        nodeRef("node-1"),
        { name: "Krystian Probierz", stats: { notesCount: 99 } },
        { approve: true, stored },
      );
      const targetData = vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
        string,
        unknown
      >;
      expect(targetData.stats).toEqual(stored.stats);
    });

    it("keeps a removed page removed", () => {
      // An approved removal is a decision, and a scraper re-run is not a review
      // of it. `pageIsPublic` reads `deleted` too, so losing it would put the
      // page back up.
      const removed = { ...stored, deleted: true, delete_reason: "duplicate" };
      const targetData = targetWrite({ approve: true, stored: removed });
      expect(targetData.deleted).toBe(true);
      expect(targetData.delete_reason).toBe("duplicate");
    });

    it("carries nothing when there is no stored document to carry from", () => {
      // A document being created owns nothing yet, beyond the counters seeded
      // for it so that it can be found.
      expect(targetWrite({ approve: true, published: true })).toEqual({
        name: "Krystian Probierz",
        type: "person",
        parties: ["PiS"],
        revision_id: { id: "new-rev-id" },
        published: true,
        stats: { nodeGroupSize: 0, isApproved: true },
      });
    });

    it("seeds the counters that decide whether a new node can be found", () => {
      // Not cosmetic, and not only the proposal form's problem: /api/search
      // orders by `stats.nodeGroupSize` and Firestore drops any document that
      // lacks the ordered field, so a person the scrapers had just ingested had
      // a page nobody could search their way to. Zero says "not counted yet";
      // `computeNodes` replaces it with the real group size.
      const created = targetWrite({ automatic: true, published: false });
      expect(created.stats).toEqual({ nodeGroupSize: 0, isApproved: false });
    });

    it("fills in a counter an existing document is missing", () => {
      // The nodes written before this was seeded keep arriving here on every
      // re-ingest; repairing them in passing is free and stops the count from
      // growing back between migration runs.
      const incomplete = {
        ...stored,
        stats: { isApproved: true, notesCount: 2 },
      };
      expect(targetWrite({ approve: true, stored: incomplete }).stats).toEqual({
        isApproved: true,
        notesCount: 2,
        nodeGroupSize: 0,
      });
    });

    it("still states the change itself", () => {
      // The carry-over is of what the node owns, not of what it said.
      expect(targetWrite({ approve: true, stored }).parties).toEqual(["PiS"]);
    });
  });
});

describe("applyRevision", () => {
  const user = { uid: "reviewer" };
  const revisionRef = { id: "rev-2" } as unknown as DocumentReference;

  /** Approve `revision` over a target that currently holds `stored`, and
   * return what the target was written with. */
  async function approveOver(
    stored: Record<string, unknown>,
    data: Record<string, unknown>,
    publish?: boolean,
  ) {
    const batch = { set: vi.fn(), update: vi.fn(), commit: vi.fn() };
    const targetRef = {
      id: "node-1",
      parent: { id: "nodes" },
      get: vi.fn().mockResolvedValue({ data: () => stored }),
    };
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => targetRef) })),
      batch: vi.fn(() => batch),
    } as unknown as Firestore;

    await applyRevision(
      db,
      revisionRef,
      { node_id: "node-1", collection: "nodes", data } as never,
      user,
      publish,
    );
    return batch.set.mock.calls[0]![1] as Record<string, unknown>;
  }

  it("keeps the counters and votes the node owns", async () => {
    // The same carry `createRevisionTransaction` makes, through the same
    // function - the two writing the same document by different rules is how
    // `stats` came to be dropped by one of them.
    const written = await approveOver(
      { stats: { isApproved: true, notesCount: 2 }, votes: { interesting: 3 } },
      { name: "Krystian Probierz" },
    );
    expect(written.stats).toMatchObject({ isApproved: true, notesCount: 2 });
    expect(written.votes).toEqual({ interesting: 3 });
  });

  it("points the node at the revision being approved", async () => {
    const written = await approveOver({}, { name: "Krystian Probierz" });
    expect(written.revision_id).toBe(revisionRef);
  });

  it("does not change who can see the page unless told to", async () => {
    expect((await approveOver({ published: true }, {})).published).toBe(true);
    expect((await approveOver({ published: false }, {})).published).toBe(false);
  });

  it("publishes when told to", async () => {
    expect((await approveOver({ published: false }, {}, true)).published).toBe(
      true,
    );
  });

  it("applies a removal, which states `deleted` in its own data", async () => {
    const written = await approveOver(
      { published: true },
      { deleted: true, delete_reason: "duplicate" },
    );
    expect(written.deleted).toBe(true);
    expect(written.delete_reason).toBe("duplicate");
  });

  it("does not resurrect a removed page by approving an ordinary edit", async () => {
    // A removal is a decision on the record; a later content edit is not a
    // review of it.
    const written = await approveOver(
      { deleted: true, delete_reason: "duplicate" },
      { name: "Krystian Probierz" },
    );
    expect(written.deleted).toBe(true);
  });
});

describe("withoutInternalFields", () => {
  it("drops the pointer to the revision the document currently says it by", () => {
    // Carrying it into a proposal would freeze a stale answer into it.
    expect(
      withoutInternalFields({
        type: "election",
        committee: "KW PiS",
        revision_id: { id: "old-rev" },
        stats: { people: 3 },
        visibility: true,
      }),
    ).toEqual({ type: "election", committee: "KW PiS" });
  });
});

describe("proposeRevisionTransaction", () => {
  const user = { uid: "test-user" };
  const targetRef = {
    id: "edge-1",
    parent: { id: "edges" },
  } as unknown as DocumentReference;
  const data = { source: "p", target: "r", type: "election", party: "PiS" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
  });

  it("leaves the live document alone", () => {
    // createRevisionTransaction cannot do this: it writes the target either
    // way, so it can record a change to a document being created but cannot
    // propose one about a document that is already there.
    proposeRevisionTransaction(mockDb, mockBatch, user, targetRef, data, {
      automatic: true,
    });

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    const [ref, written] = vi.mocked(mockBatch.set).mock.calls[0]!;
    expect(ref).not.toBe(targetRef);
    expect(written).toMatchObject({
      node_id: "edge-1",
      data,
      update_user: "test-user",
      update_automatic: true,
      status: "pending",
      collection: "edges",
    });
  });

  it("says which collection the target is in", () => {
    // `node_id` is the target's id whatever the target is, so this is the only
    // thing that makes "the pending changes to edges" a query.
    proposeRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      { id: "node-1", parent: { id: "nodes" } } as unknown as DocumentReference,
      data,
    );
    expect(vi.mocked(mockBatch.set).mock.calls[0]![1]).toMatchObject({
      collection: "nodes",
    });
  });

  it("addresses a standing proposal by what it proposes", () => {
    // `committee_to_party` names about twenty-five committees, so most
    // candidacies stay pending; with a fresh id per run the pipeline would add
    // a revision per candidacy per night, forever.
    proposeRevisionTransaction(mockDb, mockBatch, user, targetRef, data);
    expect(vi.mocked(mockCollection().doc)).toHaveBeenCalledWith(
      proposalId("edge-1", data),
    );
  });
});

describe("proposalId", () => {
  it("does not depend on the order the content was assembled in", () => {
    // The proposal is built by spreading the stored edge and the payload
    // together, and property order there follows insertion.
    expect(proposalId("edge-1", { a: 1, b: 2 })).toBe(
      proposalId("edge-1", { b: 2, a: 1 }),
    );
  });

  it("keeps two different proposals about one edge apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-1", { committee: "KW Nowa Lewica" }),
    );
  });

  it("keeps the same proposal about two edges apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-2", { committee: "KW PiS" }),
    );
  });

  it("produces an id Firestore will accept", () => {
    const id = proposalId("edge_p_teryt1465_election_aBcDeFgHiJ", {
      committee: "KW PiS",
    });
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(1500);
  });

  it("files one offer once, however the caller says it is worded", () => {
    // The ingest passes `edgeIdentity`, which folds the case and spacing PKW
    // varies. Without that, a re-scrape in a different case would file a second
    // proposal saying the same thing.
    expect(proposalId("edge-1", { committee: "KW PIS" }, "same-fact")).toBe(
      proposalId("edge-1", { committee: "Kw Pis" }, "same-fact"),
    );
  });
});

describe("getRevisionsForNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty object for empty input", async () => {
    const result = await getRevisionsForNodes(mockDb, []);
    expect(result).toEqual({});
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it("should fetch revisions for nodes in chunks", async () => {
    // Generate 15 IDs to force 2 chunks (since chunk size is 10)
    const ids = Array.from({ length: 15 }, (_, i) => `id-${i}`);

    mockGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: "rev-1",
            data: () => ({ node_id: "id-0", title: "Rev 1" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [],
      });

    const result = await getRevisionsForNodes(mockDb, ids);

    // Should call collection('revisions')
    expect(mockCollection).toHaveBeenCalledWith("revisions");

    // Should split into two calls
    expect(mockWhere).toHaveBeenCalledTimes(2);
    // First chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      1,
      "node_id",
      "in",
      ids.slice(0, 10),
    );
    // Second chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      2,
      "node_id",
      "in",
      ids.slice(10),
    );

    // Check result mapping
    expect(result["id-0"]).toHaveLength(1);
    expect(result["id-0"][0]).toEqual({
      id: "rev-1",
      node_id: "id-0",
      title: "Rev 1",
    });
    expect(result["id-1"]).toEqual([]);
  });

  it("should correctly group revisions by node_id", async () => {
    const ids = ["node-A", "node-B"];

    mockGet.mockResolvedValue({
      docs: [
        {
          id: "rev-A1",
          data: () => ({ node_id: "node-A", ver: 1 }),
        },
        {
          id: "rev-A2",
          data: () => ({ node_id: "node-A", ver: 2 }),
        },
        {
          id: "rev-B1",
          data: () => ({ node_id: "node-B", ver: 1 }),
        },
      ],
    });

    const result = await getRevisionsForNodes(mockDb, ids);

    expect(result["node-A"]).toHaveLength(2);
    expect(result["node-B"]).toHaveLength(1);
    expect(result["node-A"]).toEqual([
      { id: "rev-A1", node_id: "node-A", ver: 1 },
      { id: "rev-A2", node_id: "node-A", ver: 2 },
    ]);
  });
});

describe("the update_automatic invariant", () => {
  /** `createRevisionTransaction` used to write the field only when it was true,
   * which left a human proposal carrying nothing at all - and Firestore matches
   * no equality against an absent field, so every relation a reader added was
   * invisible to the review queue that exists to find it. */
  it("records that a human made the change, not only that a pipeline did", () => {
    const batch = { set: vi.fn() } as unknown as WriteBatch;
    const targetRef = {
      id: "node-1",
      parent: { id: "nodes" },
    } as unknown as DocumentReference;

    createRevisionTransaction(
      mockDb as unknown as Firestore,
      batch,
      { uid: "human" },
      targetRef,
      { name: "Jan Kowalski", type: "person" },
    );

    const [, revision] = vi.mocked(batch.set).mock.calls[0]!;
    expect(revision).toMatchObject({ update_automatic: false });
  });

  it("still marks a pipeline write as automatic", () => {
    const batch = { set: vi.fn() } as unknown as WriteBatch;
    const targetRef = {
      id: "node-2",
      parent: { id: "nodes" },
    } as unknown as DocumentReference;

    createRevisionTransaction(
      mockDb as unknown as Firestore,
      batch,
      { uid: "pipeline" },
      targetRef,
      { name: "Jan Kowalski", type: "person" },
      { automatic: true },
    );

    const [, revision] = vi.mocked(batch.set).mock.calls[0]!;
    expect(revision).toMatchObject({ update_automatic: true });
  });
  it("partitions a document the same way the diff does", () => {
    // `revisionChanges` skips the fields a document owns rather than states,
    // because a revision written before the ingest stripped them still carries
    // them inside its own `data` - `revision_id` among them, which decodes to a
    // DocumentReference with no readable rendering at all. The two lists have
    // to agree or those fields come back as changes on one side only.
    for (const field of INTERNAL_FIELDS) {
      expect(skippedChangeFields.has(field), `${field} is diffed`).toBe(true);
    }
  });
});

describe("sameStoredValue", () => {
  it("does not mind what order the keys are in", () => {
    // The one thing a stringify comparison gets wrong. A revision is built by
    // spreading a payload over the stored document, which moves every field the
    // payload restates to the end of the object.
    expect(sameStoredValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("does mind what order an array is in", () => {
    // `activity` is a list of PKD codes and `parties` a list of parties, and
    // the order they are stored in is what the page shows.
    expect(sameStoredValue(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("tells an absent field from one set to undefined", () => {
    expect(sameStoredValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("compares nested maps and arrays by value", () => {
    expect(
      sameStoredValue(
        { stats: { nodeGroupSize: 2 }, categories: ["koleje"] },
        { stats: { nodeGroupSize: 2 }, categories: ["koleje"] },
      ),
    ).toBe(true);
    expect(
      sameStoredValue(
        { stats: { nodeGroupSize: 2 } },
        { stats: { nodeGroupSize: 3 } },
      ),
    ).toBe(false);
  });

  it("asks a Firestore value how it compares", () => {
    // A Timestamp or a DocumentReference is a class instance, so identity would
    // say two readings of the same document differ. Both carry `isEqual`.
    const stamp = (millis: number) => ({
      millis,
      isEqual(other: { millis: number }) {
        return other.millis === millis;
      },
    });
    expect(sameStoredValue(stamp(1), stamp(1))).toBe(true);
    expect(sameStoredValue(stamp(1), stamp(2))).toBe(false);
    // And a plain map is not one of them, whichever side it is on.
    expect(sameStoredValue(stamp(1), { millis: 1 })).toBe(false);
  });
});

describe("revisionChangesNothing", () => {
  /** A company as the ingest finds it: live, approved, counted. */
  const storedCompany = () => ({
    name: "PKP Szybka Kolej Miejska w Trójmieście",
    type: "place",
    krsNumber: "0000076705",
    activity: ["49.12.Z", "49.31.Z"],
    categories: ["koleje"],
    isPublic: true,
    published: true,
    revision_id: { id: "rev-1" },
    stats: { nodeGroupSize: 4, isApproved: true },
  });

  const approvedOptions = (stored: Record<string, unknown>) => ({
    automatic: true,
    approve: true,
    stored,
    published: true,
  });

  it("recognises a payload that restates what the node already says", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(true);
  });

  it("agrees with the write it is standing in for", () => {
    // The point of the two sharing `revisionTargetData`: where this says
    // nothing would change, the write it skipped really would have set the
    // document back to exactly what it holds - bar the pointer to the new
    // revision, which is the one field a skip leaves as it was.
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
    const stored = storedCompany();
    const data = withoutInternalFields(stored);
    const targetRef = nodeRef("node-1");

    expect(
      revisionChangesNothing(targetRef, data, approvedOptions(stored)),
    ).toBe(true);

    createRevisionTransaction(
      mockDb,
      mockBatch,
      { uid: "pipeline" },
      targetRef,
      data,
      approvedOptions(stored),
    );
    const written = {
      ...(vi.mocked(mockBatch.set).mock.calls[1]![1] as object),
    };
    delete (written as { revision_id?: unknown }).revision_id;
    expect(written).toEqual({ ...stored, revision_id: undefined });
  });

  it("does not mind the payload putting the fields in another order", () => {
    const stored = storedCompany();
    const reordered = {
      krsNumber: stored.krsNumber,
      categories: stored.categories,
      isPublic: stored.isPublic,
      activity: stored.activity,
      type: stored.type,
      name: stored.name,
    };
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        reordered,
        approvedOptions(stored),
      ),
    ).toBe(true);
  });

  it("sees a field the payload has learned", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        {
          ...withoutInternalFields(stored),
          categories: ["koleje", "szpitale"],
        },
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("sees a field the write would delete", () => {
    // The write is a `set`, so a revision that says less than the document does
    // is not a no-op: it drops the difference.
    const stored = storedCompany();
    const { isPublic: _dropped, ...without } = withoutInternalFields(stored);
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        without,
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("never skips creating a document", () => {
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        { name: "Nowa", type: "place" },
        {
          automatic: true,
          approve: true,
          published: true,
        },
      ),
    ).toBe(false);
  });

  it("writes a company that has no approved revision to point at", () => {
    // Approving is what gives the node its `revision_id`, so a node without one
    // needs the write even where it already says the right thing.
    const { revision_id: _none, ...stored } = storedCompany();
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("writes a company whose counters nothing has filled in", () => {
    // `withSeededNodeStats` would add them, and `/api/nodes` filters every
    // listing on `stats.isApproved` - a node missing it is on the site and in
    // no list that leads there, so the write is a repair.
    const { stats: _none, ...stored } = storedCompany();
    expect(
      revisionChangesNothing(
        nodeRef("node-1"),
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(false);
  });

  it("writes when the caller is changing what the public can see", () => {
    const stored = storedCompany();
    expect(
      revisionChangesNothing(nodeRef("node-1"), withoutInternalFields(stored), {
        ...approvedOptions(stored),
        published: false,
      }),
    ).toBe(false);
  });

  it("does not ask an edge for the counters only a node carries", () => {
    const stored = {
      source: "node-1",
      target: "node-2",
      type: "employed",
      name: "Prezes",
      published: true,
      revision_id: { id: "rev-1" },
    };
    expect(
      revisionChangesNothing(
        targetRefIn("edges", "edge-1"),
        withoutInternalFields(stored),
        approvedOptions(stored),
      ),
    ).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/admin/summary.get";
import { OPEN_CAP, QUEUE_STEP } from "../../../../shared/feedbackQueue";

/** A chainable query that remembers which collection it came from and what it
 * was filtered, ordered and capped by, so one mock can serve the different
 * reads the handler makes without the test depending on the order they happen
 * in. */
type Where = [unknown, string, unknown];
type OrderBy = [string, "asc" | "desc"];
type Shape = { wheres: Where[]; orderBy: OrderBy[]; limit?: number };
type Doc = ReturnType<typeof doc>;

const results = {
  notes: [] as Doc[],
  unapprovedNodes: { count: 0, docs: [] as Doc[] },
  edgeRevisions: { count: 0, docs: [] as Doc[] },
  // Every feedback document there is, whatever its status. The handler's
  // equality filters are applied to it, so a test can put a settled report
  // next to a new one and see which the query lets through.
  feedback: [] as Doc[],
  namedNodes: [] as Doc[],
};

/** Every `get()` the handler made, with the shape of the query behind it. */
const reads: ({ collection: string } & Shape)[] = [];

function makeQuery(
  collection: string,
  shape: Shape = { wheres: [], orderBy: [] },
) {
  const { wheres } = shape;
  const query = {
    where: (...w: Where) =>
      makeQuery(collection, { ...shape, wheres: [...wheres, w] }),
    select: () => query,
    orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
      makeQuery(collection, {
        ...shape,
        orderBy: [...shape.orderBy, [field, direction]],
      }),
    limit: (limit: number) => makeQuery(collection, { ...shape, limit }),
    count: () => ({ get: async () => ({ data: () => ({ count: total() }) }) }),
    get: async () => {
      reads.push({ collection, ...shape });
      const docs = shaped(resolve());
      return { docs, empty: docs.length === 0 };
    },
  };

  function isEdgeRevisions() {
    return collection === "revisions";
  }
  function isUnapprovedNodes() {
    return (
      collection === "nodes" &&
      wheres.some((w) => w[0] === "revisions.has_unapproved")
    );
  }
  function isFeedback() {
    return collection === "feedback";
  }
  function matchesFilters(d: Doc) {
    return wheres.every(([field, op, value]) => {
      if (op !== "==") throw new Error(`unexpected ${op} on ${collection}`);
      return d.get(field as string) === value;
    });
  }
  /** What Firestore hands back: in the order asked for, and no more than the
   * limit. */
  function shaped(docs: Doc[]) {
    const ordered = [...docs].sort((a, b) => {
      for (const [field, direction] of shape.orderBy) {
        const [x, y] = [a.get(field), b.get(field)] as [string, string];
        if (x !== y) return (x < y ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    return ordered.slice(0, shape.limit ?? ordered.length);
  }

  function total() {
    if (isEdgeRevisions()) return results.edgeRevisions.count;
    if (isUnapprovedNodes()) return results.unapprovedNodes.count;
    // Counted from the documents, so the count and the read agree on which
    // reports the filters let through.
    if (isFeedback())
      return shaped(results.feedback.filter(matchesFilters)).length;
    throw new Error(`unexpected count() on ${collection}`);
  }
  function resolve() {
    if (collection === "notes") return results.notes;
    if (isEdgeRevisions()) return results.edgeRevisions.docs;
    if (isUnapprovedNodes()) return results.unapprovedNodes.docs;
    if (isFeedback()) return results.feedback.filter(matchesFilters);
    // The remaining read on `nodes` resolves names for the notes sample.
    return results.namedNodes;
  }

  return query;
}

/** Documents handed back by `getAll`, keyed by the collection asked for. */
const byId: Record<string, Record<string, Record<string, unknown>>> = {
  revisions: {},
  edges: {},
  nodes: {},
};

const mockDb = {
  collection: (name: string) => ({
    ...makeQuery(name),
    doc: (id: string) => ({ id, __collection: name }),
  }),
  getAll: async (...refs: { id: string; __collection: string }[]) =>
    refs.map((ref) => doc(ref.id, byId[ref.__collection]?.[ref.id])),
};

function doc(id: string, data?: Record<string, unknown>) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) =>
      field
        .split(".")
        .reduce<unknown>(
          (value, key) =>
            value === undefined || value === null
              ? undefined
              : (value as Record<string, unknown>)[key],
          data as unknown,
        ),
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldPath: { documentId: () => "__name__" },
}));

const mockGetUser = vi.fn();
vi.mock("../../../../server/utils/auth", () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

/** A pending edge revision, as the ingest and the relation form both write it:
 * `collection: "edges"`, and `update_automatic` only when the pipeline filed
 * it. */
function edgeRevision(id: string, edgeId: string, automatic = false) {
  return doc(id, {
    node_id: edgeId,
    collection: "edges",
    status: "pending",
    update_time: "2026-08-04T00:00:00.000Z",
    update_user: "user-1",
    ...(automatic ? { update_automatic: true } : {}),
  });
}

/** A report as /api/feedback/create writes it: status "new", and no queueRank
 * until somebody puts it in the queue on /admin/opinie. */
function report(
  id: string,
  createdAt: string,
  extra: Record<string, unknown> = {},
) {
  return doc(id, {
    kind: "bug",
    message: `Zgłoszenie ${id}`,
    context: { route: "/entity/person/1" },
    createdAt,
    adminStatus: "new",
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
  results.notes = [];
  results.unapprovedNodes = { count: 0, docs: [] };
  results.edgeRevisions = { count: 0, docs: [] };
  results.feedback = [];
  results.namedNodes = [];
  byId.revisions = {};
  byId.edges = {};
  byId.nodes = {};
  reads.length = 0;
});

describe("GET /api/admin/summary", () => {
  it("refuses a caller who is not an admin", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader-1", admin: false });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("counts an untriaged correction or reported gap as needing action", async () => {
    results.notes = [
      doc("note-1", {
        nodeId: "node-1",
        sources: [
          // "Do poprawy" - somebody saying the data is wrong, which is work
          // waiting on an admin before anybody has triaged it.
          { note: "zła data urodzenia", kind: "change_request" },
          // "Brakuje danych" - the same, reported as an absence rather than
          // as a mistake.
          { note: "brakuje zarządu", kind: "missing" },
          // Settled, so it is off the list even though it is a correction.
          {
            note: "poprawione",
            kind: "change_request",
            adminStatus: "resolved",
          },
          // A source only counts once a reviewer flags it.
          { note: "ciekawy artykuł", url: "https://example.com" },
          { note: "do sprawdzenia", adminStatus: "unresolved" },
        ],
      }),
    ];
    results.namedNodes = [doc("node-1", { name: "Jan Kowalski" })];

    const summary = await handler({} as never);

    expect(summary.notes.needsAction).toBe(3);
    expect(summary.notes.sample.map((item) => item.note)).toEqual([
      "zła data urodzenia",
      "brakuje zarządu",
      "do sprawdzenia",
    ]);
    expect(summary.notes.sample[0]).toMatchObject({
      name: "Jan Kowalski",
      kind: "change_request",
      adminType: null,
    });
  });

  it("leaves a report somebody has put in the queue out of the untriaged count", async () => {
    results.feedback = [
      report("fb-unranked", "2026-09-20T10:00:00.000Z"),
      // Given a place in the queue on /admin/opinie: somebody has decided when
      // it gets worked on, which is triage even though it still says "nowe".
      report("fb-ranked", "2026-09-21T10:00:00.000Z", { queueRank: 1024 }),
      // The first report put in an empty queue gets rank 0, so a truthiness
      // check on the rank would take it for one nobody has placed.
      report("fb-first", "2026-09-22T10:00:00.000Z", { queueRank: 0 }),
      // Dropped above the head of the queue, where ranks go below zero.
      report("fb-top", "2026-09-22T11:00:00.000Z", { queueRank: -1024 }),
    ];

    const summary = await handler({} as never);

    expect(summary.feedback.needsAction).toBe(1);
    expect(summary.feedback.sample.map((item) => item.id)).toEqual([
      "fb-unranked",
    ]);
  });

  it("counts only reports still marked new, queued or not", async () => {
    results.feedback = [
      report("fb-new", "2026-09-20T10:00:00.000Z"),
      // Somebody is on it, or it is closed: triaged either way, even with no
      // place in the queue. One that has a place is not taken off the count
      // of new ones a second time.
      report("fb-progress", "2026-09-21T10:00:00.000Z", {
        adminStatus: "in_progress",
        queueRank: 0,
      }),
      report("fb-resolved", "2026-09-21T11:00:00.000Z", {
        adminStatus: "resolved",
      }),
      report("fb-wont-fix", "2026-09-21T12:00:00.000Z", {
        adminStatus: "wont_fix",
      }),
    ];

    const summary = await handler({} as never);

    expect(summary.feedback.needsAction).toBe(1);
    expect(summary.feedback.sample.map((item) => item.id)).toEqual(["fb-new"]);
  });

  it("samples the newest untriaged reports but counts all of them", async () => {
    // Twelve unranked reports, stored out of order so the order in the sample
    // comes from what the handler asked for rather than from the fixture.
    const days = [5, 12, 1, 9, 3, 11, 7, 2, 10, 4, 8, 6];
    results.feedback = [
      ...days.map((day) =>
        report(
          `fb-${day}`,
          `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`,
        ),
      ),
      // Newer than any of them but already queued, so it must not take one of
      // the eight slots either.
      report("fb-queued", "2026-09-20T12:00:00.000Z", { queueRank: 0 }),
    ];

    const summary = await handler({} as never);

    expect(summary.feedback.needsAction).toBe(12);
    expect(summary.feedback.sample.map((item) => item.id)).toEqual([
      "fb-12",
      "fb-11",
      "fb-10",
      "fb-9",
      "fb-8",
      "fb-7",
      "fb-6",
      "fb-5",
    ]);
  });

  it("reads only the newest new reports, so past the cap the count is an upper bound", async () => {
    // One report a minute, oldest first. The newest is queued, and so are the
    // two oldest - but those two are past what the handler reads, so it cannot
    // know they are queued and still counts them.
    const queued = new Set([0, 1, OPEN_CAP + 1]);
    results.feedback = Array.from({ length: OPEN_CAP + 2 }, (_, i) =>
      report(
        `fb-${i}`,
        new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
        queued.has(i) ? { queueRank: i * QUEUE_STEP } : {},
      ),
    );

    const summary = await handler({} as never);

    expect(reads.filter((read) => read.collection === "feedback")).toEqual([
      {
        collection: "feedback",
        wheres: [["adminStatus", "==", "new"]],
        orderBy: [["createdAt", "desc"]],
        limit: OPEN_CAP,
      },
    ]);
    // 502 new, less the one queued report among the 500 it read.
    expect(summary.feedback.needsAction).toBe(OPEN_CAP + 1);
    expect(summary.feedback.sample.map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `fb-${OPEN_CAP - i}`),
    );
  });

  it("describes each sampled report the way the dashboard shows it", async () => {
    results.feedback = [
      report("fb-long", "2026-09-21T10:00:00.000Z", {
        kind: "data",
        message: "a".repeat(300),
        context: { route: "/entity/person/7", pageTitle: "Jan Kowalski" },
      }),
      // Reports filed before the page title was captured have none.
      report("fb-old", "2026-09-20T10:00:00.000Z"),
    ];

    const summary = await handler({} as never);

    expect(summary.feedback.sample).toEqual([
      {
        id: "fb-long",
        kind: "data",
        // Trimmed: the dashboard shows a line of each, not the whole report.
        message: "a".repeat(200),
        route: "/entity/person/7",
        pageTitle: "Jan Kowalski",
        createdAt: "2026-09-21T10:00:00.000Z",
      },
      {
        id: "fb-old",
        kind: "bug",
        message: "Zgłoszenie fb-old",
        route: "/entity/person/1",
        pageTitle: null,
        createdAt: "2026-09-20T10:00:00.000Z",
      },
    ]);
  });

  it("counts unsettled edge revisions alongside unapproved nodes", async () => {
    results.unapprovedNodes = {
      count: 3,
      docs: [
        doc("node-1", { name: "Jan Kowalski", type: "person", revisions: {} }),
      ],
    };
    results.edgeRevisions = {
      count: 2,
      docs: [edgeRevision("rev-1", "edge-1")],
    };
    byId.edges["edge-1"] = {
      source: "person-1",
      target: "teryt1465",
      type: "election",
    };
    byId.nodes["person-1"] = { name: "Jan Kowalski" };
    byId.nodes["teryt1465"] = { name: "Powiat kaliski" };

    const summary = await handler({} as never);

    // 3 nodes whose latest revision is unapproved, plus 2 edge proposals.
    expect(summary.revisions.unapproved).toBe(5);
    // Of the ones we could inspect: one node, one edge, both filed by a human.
    expect(summary.revisions.unapprovedManual).toBe(2);
    expect(summary.revisions.sample).toEqual([
      { kind: "node", id: "node-1", name: "Jan Kowalski", type: "person" },
      {
        kind: "edge",
        id: "rev-1",
        name: "Jan Kowalski → Powiat kaliski",
        type: "election",
      },
    ]);
  });

  it("leaves the pipeline's own proposals out of the manual count", async () => {
    // What the candidacy ingest files: a committee its curated table does not
    // recognise, proposed rather than applied. It belongs in
    // /admin/rewizje#powiazania, not in the count of work a human has queued.
    results.edgeRevisions = {
      count: 40,
      docs: [
        edgeRevision("rev-auto-1", "edge-1", true),
        edgeRevision("rev-auto-2", "edge-2", true),
      ],
    };

    const summary = await handler({} as never);

    expect(summary.revisions.unapproved).toBe(40);
    expect(summary.revisions.unapprovedManual).toBe(0);
    expect(summary.revisions.sample).toEqual([]);
  });

  it("reports truncation when more edge proposals wait than it inspected", async () => {
    results.edgeRevisions = {
      count: 500,
      docs: [edgeRevision("rev-1", "edge-1")],
    };
    byId.edges["edge-1"] = { source: "a", target: "b", type: "employed" };

    const summary = await handler({} as never);

    expect(summary.revisions.truncated).toBe(true);
    expect(summary.revisions.inspected).toBe(1);
  });

  it("names an edge whose endpoints it cannot resolve by its id", async () => {
    // The edge was deleted after the proposal was filed. It is still waiting on
    // somebody, so it still counts.
    results.edgeRevisions = {
      count: 1,
      docs: [edgeRevision("rev-1", "edge-gone")],
    };

    const summary = await handler({} as never);

    expect(summary.revisions.unapprovedManual).toBe(1);
    expect(summary.revisions.sample).toEqual([
      { kind: "edge", id: "rev-1", name: "edge-gone", type: "" },
    ]);
  });

  it("gives each kind half the sample rather than letting one crowd the other", async () => {
    results.unapprovedNodes = {
      count: 10,
      docs: Array.from({ length: 10 }, (_, i) =>
        doc(`node-${i}`, { name: `Osoba ${i}`, type: "person", revisions: {} }),
      ),
    };
    results.edgeRevisions = {
      count: 6,
      docs: Array.from({ length: 6 }, (_, i) =>
        edgeRevision(`rev-${i}`, `edge-${i}`),
      ),
    };
    for (let i = 0; i < 6; i++) {
      byId.edges[`edge-${i}`] = { source: "a", target: "b", type: "employed" };
    }
    byId.nodes["a"] = { name: "A" };
    byId.nodes["b"] = { name: "B" };

    const summary = await handler({} as never);

    const kinds = summary.revisions.sample.map((item) => item.kind);
    expect(kinds).toHaveLength(8);
    expect(kinds.filter((k) => k === "node")).toHaveLength(4);
    expect(kinds.filter((k) => k === "edge")).toHaveLength(4);
  });

  it("lets one kind spread into the slots the other leaves unused", async () => {
    results.unapprovedNodes = {
      count: 10,
      docs: Array.from({ length: 10 }, (_, i) =>
        doc(`node-${i}`, { name: `Osoba ${i}`, type: "person", revisions: {} }),
      ),
    };
    results.edgeRevisions = { count: 1, docs: [edgeRevision("rev-1", "e-1")] };
    byId.edges["e-1"] = { source: "a", target: "b", type: "employed" };
    byId.nodes["a"] = { name: "A" };
    byId.nodes["b"] = { name: "B" };

    const summary = await handler({} as never);

    const kinds = summary.revisions.sample.map((item) => item.kind);
    expect(kinds.filter((k) => k === "node")).toHaveLength(7);
    expect(kinds.filter((k) => k === "edge")).toHaveLength(1);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  AUTHOR_SCAN_CAP,
  type RevisionQueue,
} from "../../../../server/api/revisions/queue.get";
import {
  clearQueueScans,
  forgetQueued,
} from "../../../../server/utils/queueScan";

type Data = Record<string, unknown>;

/** The `revisions` collection, keyed by id and read in insertion order. */
let revisions: Record<string, Data> = {};
/** The documents those revisions describe, keyed by `<collection>/<id>`. */
let targets: Record<string, Data> = {};

const { mockGetUser, mockGetUsers, headers } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  return {
    mockGetUser: vi.fn(),
    mockGetUsers: vi.fn(),
    headers: new Map<string, string>(),
  };
});

const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();
const mockSelect = vi.fn();

function snapshotOf(id: string, data: Data | undefined) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  };
}

type Snapshot = ReturnType<typeof snapshotOf>;

function documentAt(path: string): Data | undefined {
  const [collection, id] = path.split("/");
  return collection === "revisions" ? revisions[id!] : targets[path];
}

/** Firestore's `==` and `!=`, including the half of them this endpoint turns
 * on: a document that does not carry the field at all matches neither, and
 * `!=` leaves out a null too. */
function matches(data: Data, field: string, op: string, value: unknown) {
  if (op === "==") return field in data && data[field] === value;
  if (op === "!=")
    return field in data && data[field] !== null && data[field] !== value;
  throw new Error(`the fake only knows "==" and "!=", not "${op}"`);
}

/** A query over `docs`, recorded so a test can assert the clause and applied
 * for real so it also sees the rows that clause would return. */
function queryOver(docs: Snapshot[]) {
  return {
    where(field: string, op: string, value: unknown) {
      mockWhere(field, op, value);
      return queryOver(
        docs.filter((doc) => matches(doc.data() ?? {}, field, op, value)),
      );
    },
    orderBy(field: string, direction: "asc" | "desc") {
      mockOrderBy(field, direction);
      const sorted = [...docs].sort((a, b) =>
        String(b.get(field) ?? "").localeCompare(String(a.get(field) ?? "")),
      );
      return queryOver(direction === "desc" ? sorted : sorted.reverse());
    },
    offset(count: number) {
      mockOffset(count);
      return queryOver(docs.slice(count));
    },
    limit(count: number) {
      mockLimit(count);
      return queryOver(docs.slice(0, count));
    },
    /** A field mask. The fake keeps whole documents either way. */
    select(...fields: string[]) {
      mockSelect(...fields);
      return queryOver(docs);
    },
    count: () => ({
      get: async () => ({ data: () => ({ count: docs.length }) }),
    }),
    get: async () => ({ docs, size: docs.length, empty: docs.length === 0 }),
  };
}

/** The bulk read. The staleness lookup passes a field mask after the refs,
 * which is ignored here - the fake keeps whole documents either way. */
const mockGetAll = vi.fn(async (...args: unknown[]) => {
  const refs = args.filter(
    (arg): arg is { id: string; path: string } =>
      !!arg && typeof (arg as { path?: unknown }).path === "string",
  );
  return refs.map((ref) => snapshotOf(ref.id, documentAt(ref.path)));
});

const mockDb = {
  collection: (name: string) => ({
    ...queryOver(
      name === "revisions"
        ? Object.entries(revisions).map(([id, data]) => snapshotOf(id, data))
        : [],
    ),
    doc: (id: string) => ({
      id,
      path: `${name}/${id}`,
      get: async () => snapshotOf(id, documentAt(`${name}/${id}`)),
    }),
  }),
  getAll: mockGetAll,
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  // `server/utils/revisions` imports both as values, on paths this endpoint
  // does not reach.
  Timestamp: { now: () => "now" },
  FieldValue: { delete: () => "DELETED" },
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers }),
}));

vi.mock("../../../../server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query?: unknown },
      parse: (q: unknown) => unknown,
    ) => parse(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

const call = (query: Data = {}) =>
  (handler as unknown as (event: unknown) => Promise<RevisionQueue>)({ query });

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A human proposal against `node-1`, filed with the flag.
 *
 * An override of `undefined` removes the field rather than setting it to
 * nothing, which is how the 1,760 flagless revisions are stored and the only
 * way to reproduce what they do to a query.
 */
function addRevision(id: string, overrides: Data = {}) {
  const doc: Data = {
    node_id: "node-1",
    collection: "nodes",
    data: { name: "Anna Nowak", type: "person", content: "Nowy opis." },
    status: "pending",
    update_time: "2026-08-10T09:00:00.000Z",
    update_user: "volunteer-uid",
    update_automatic: false,
    ...overrides,
  };
  revisions[id] = Object.fromEntries(
    Object.entries(doc).filter(([, value]) => value !== undefined),
  );
}

/** Point a target at an approved revision holding `data`, the way a published
 * entry really is stored. Written far enough in the past that it never reads as
 * having overtaken a proposal filed later. */
function approveOnto(nodeId: string, revisionId: string, data: Data) {
  revisions[revisionId] = {
    node_id: nodeId,
    collection: "nodes",
    data,
    status: "approved",
    update_time: "2026-01-01T00:00:00.000Z",
    review_time: "2026-01-01T00:00:00.000Z",
    update_user: "admin-uid",
    update_automatic: false,
  };
  targets[`nodes/${nodeId}`] = {
    ...(targets[`nodes/${nodeId}`] ?? {}),
    revision_id: `revisions/${revisionId}`,
  };
}

describe("api/revisions/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueueScans();
    revisions = {};
    targets = {};
    headers.clear();
    mockGetUser.mockResolvedValue({ uid: "admin-uid", admin: true });
    mockGetUsers.mockResolvedValue({ users: [] });
    targets["nodes/node-1"] = {
      name: "Anna Nowak",
      type: "person",
      content: "Stary opis.",
      published: true,
    };
  });

  it("refuses a signed-in caller who is not an admin", async () => {
    // It reads uids, emails and display names through the admin SDK, which is
    // the same reason /api/users/lookup is closed.
    mockGetUser.mockResolvedValue({ uid: "volunteer-uid" });

    await expect(call()).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses a caller with no token at all", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("asks Firestore for the pending human proposals, newest first", async () => {
    // The load-bearing decision of the whole page: an admin opening the queue
    // sees the backlog of proposals waiting for a decision, not the 42,730
    // rows the pipeline filed. Changing either clause silently re-breaks it.
    addRevision("rev-1");

    const result = await call();

    expect(mockWhere).toHaveBeenCalledWith("update_automatic", "==", false);
    expect(mockWhere).toHaveBeenCalledWith("status", "==", "pending");
    expect(mockWhere).toHaveBeenCalledTimes(2);
    expect(mockOrderBy).toHaveBeenCalledWith("update_time", "desc");
    expect(mockLimit).toHaveBeenCalledWith(25);
    expect(ids(result.revisions)).toEqual(["rev-1"]);
  });

  it("leaves out the pipeline, and says the older history is out too", async () => {
    // `update_automatic == false` matches neither the pipeline's `true` nor
    // the 1,760 revisions that carry no flag, and only the second of those is
    // a loss. `flagOnly` is what makes the page admit to it.
    addRevision("human", { update_time: "2026-08-10T09:00:00.000Z" });
    addRevision("pipeline", {
      update_automatic: true,
      update_user: "pipeline-uid",
      update_time: "2026-08-11T09:00:00.000Z",
    });
    addRevision("legacy", {
      update_automatic: undefined,
      update_time: "2026-08-09T09:00:00.000Z",
    });

    const result = await call();

    expect(ids(result.revisions)).toEqual(["human"]);
    expect(result.flagOnly).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("drops the flag filter, and the claim, when asked for everything", async () => {
    addRevision("human", { update_time: "2026-08-10T09:00:00.000Z" });
    addRevision("pipeline", {
      update_automatic: true,
      update_time: "2026-08-11T09:00:00.000Z",
    });
    addRevision("legacy", {
      update_automatic: undefined,
      update_time: "2026-08-09T09:00:00.000Z",
    });

    const result = await call({ automatic: "all", status: "all" });

    expect(mockWhere).not.toHaveBeenCalled();
    expect(ids(result.revisions)).toEqual(["pipeline", "human", "legacy"]);
    expect(result.flagOnly).toBe(false);
  });

  it("pages through the queue with Firestore's own offset", async () => {
    for (let i = 1; i <= 5; i++) {
      addRevision(`rev-${i}`, { update_time: `2026-08-0${i}T09:00:00.000Z` });
    }

    const result = await call({ limit: 2, page: 2 });

    expect(mockOffset).toHaveBeenCalledWith(2);
    expect(mockLimit).toHaveBeenCalledWith(2);
    // Newest first, so page two of five is the third and fourth newest.
    expect(ids(result.revisions)).toEqual(["rev-3", "rev-2"]);
    expect(result.total).toBe(5);
  });

  describe("everybody's but one person's", () => {
    // What the owner opens the queue for: the proposals somebody else filed,
    // with his own edits - the bulk of the human ones - out of the way.
    const interleave = () => {
      addRevision("theirs-1", { update_time: "2026-08-01T09:00:00.000Z" });
      addRevision("mine-1", {
        update_user: "admin-uid",
        update_time: "2026-08-02T09:00:00.000Z",
      });
      addRevision("theirs-2", { update_time: "2026-08-03T09:00:00.000Z" });
      addRevision("mine-2", {
        update_user: "admin-uid",
        update_time: "2026-08-04T09:00:00.000Z",
      });
      addRevision("theirs-3", {
        update_user: "other-uid",
        update_time: "2026-08-05T09:00:00.000Z",
      });
    };

    it("leaves them out in the query, so the pages and the count stay exact", async () => {
      interleave();

      const first = await call({ excludeAuthor: "admin-uid", limit: 2 });

      expect(mockWhere).toHaveBeenCalledWith("update_user", "!=", "admin-uid");
      expect(mockWhere).toHaveBeenCalledWith("update_automatic", "==", false);
      expect(mockWhere).toHaveBeenCalledWith("status", "==", "pending");
      expect(mockOrderBy).toHaveBeenCalledWith("update_time", "desc");
      expect(ids(first.revisions)).toEqual(["theirs-3", "theirs-2"]);
      // Counted by Firestore over the same clauses - not the page's length,
      // and not everything less what one page happened to drop.
      expect(first.total).toBe(3);

      vi.clearAllMocks();
      const second = await call({
        excludeAuthor: "admin-uid",
        limit: 2,
        page: 2,
      });

      expect(mockOffset).toHaveBeenCalledWith(2);
      expect(ids(second.revisions)).toEqual(["theirs-1"]);
      expect(second.total).toBe(3);
    });

    it("answers nothing for the one person it was asked to leave out", async () => {
      interleave();

      const result = await call({
        author: "admin-uid",
        excludeAuthor: "admin-uid",
        status: "all",
      });

      expect(result.revisions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("has an index for every combination of clauses it can send", async () => {
      // The emulator needs none, so nothing but production would notice one
      // missing - and there the queue would fail to load.
      const indexes = (
        JSON.parse(
          readFileSync(
            // At the root of the repo, whether the tests run from there or
            // from frontend/.
            existsSync(resolve(process.cwd(), "firestore.indexes.json"))
              ? resolve(process.cwd(), "firestore.indexes.json")
              : resolve(process.cwd(), "..", "firestore.indexes.json"),
            "utf8",
          ),
        ).indexes as {
          collectionGroup: string;
          fields: { fieldPath: string; order: string }[];
        }[]
      )
        .filter((index) => index.collectionGroup === "revisions")
        .map((index) =>
          index.fields.map((f) => `${f.fieldPath} ${f.order}`).join(", "),
        );

      for (const automatic of ["false", "true", "all"]) {
        for (const status of ["pending", "all"]) {
          mockWhere.mockClear();
          await call({ automatic, status, excludeAuthor: "admin-uid" });
          const equalities = mockWhere.mock.calls
            .filter(([, op]) => op === "==")
            .map(([field]) => `${field} ASCENDING`);
          // Firestore orders by the inequality after the explicit order, in
          // the same direction, so that is where the index has it.
          expect(indexes).toContain(
            [
              ...equalities,
              "update_time DESCENDING",
              "update_user DESCENDING",
            ].join(", "),
          );
        }
      }
    });

    it("does not narrow one person's history by somebody else's exclusion", async () => {
      interleave();

      const result = await call({
        author: "volunteer-uid",
        excludeAuthor: "admin-uid",
      });

      expect(ids(result.revisions)).toEqual(["theirs-2", "theirs-1"]);
    });
  });

  describe("one person's history", () => {
    it("reads everything they filed, flag or no flag", async () => {
      // The case the per-person view exists for: a revision carrying no
      // `update_automatic` at all is human work the aggregate query cannot
      // see, and 1,760 production revisions look exactly like this.
      addRevision("rev-flagless", {
        update_automatic: undefined,
        update_time: "2026-07-01T09:00:00.000Z",
      });
      addRevision("rev-flagged", { update_time: "2026-08-01T09:00:00.000Z" });
      addRevision("rev-pipeline", {
        update_automatic: true,
        update_time: "2026-08-02T09:00:00.000Z",
      });
      addRevision("rev-somebody-else", {
        update_user: "other-uid",
        update_time: "2026-08-03T09:00:00.000Z",
      });

      const result = await call({ author: "volunteer-uid", status: "all" });

      expect(mockWhere).toHaveBeenCalledWith(
        "update_user",
        "==",
        "volunteer-uid",
      );
      // No status clause: an equality would match none of the revisions that
      // carry no status, which is most of what this view is for.
      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(mockOrderBy).toHaveBeenCalledWith("update_time", "desc");
      expect(mockLimit).toHaveBeenCalledWith(AUTHOR_SCAN_CAP);
      expect(ids(result.revisions)).toEqual(["rev-flagged", "rev-flagless"]);
      expect(result.flagOnly).toBe(false);
    });

    it("keeps a flagless revision in the default pending view", async () => {
      // It carries no status either, and absent reads as pending.
      addRevision("rev-flagless", { update_automatic: undefined });

      const result = await call({ author: "volunteer-uid" });

      expect(ids(result.revisions)).toEqual(["rev-flagless"]);
      expect(result.revisions[0]!.status).toBe("pending");
    });

    it("filters the status in memory, over the whole scan", async () => {
      addRevision("rev-pending", { update_time: "2026-08-01T09:00:00.000Z" });
      addRevision("rev-rejected", {
        status: "rejected",
        reject_reason: "Brak źródła.",
        update_time: "2026-08-02T09:00:00.000Z",
      });

      const result = await call({
        author: "volunteer-uid",
        status: "rejected",
      });

      expect(ids(result.revisions)).toEqual(["rev-rejected"]);
      expect(result.total).toBe(1);
      expect(result.revisions[0]!.rejectReason).toBe("Brak źródła.");
    });

    it("says the answer is a lower bound once the scan hits its cap", async () => {
      for (let i = 0; i < AUTHOR_SCAN_CAP; i++) {
        addRevision(`rev-${i}`, {
          update_time: new Date(
            Date.UTC(2026, 0, 1) + i * 60_000,
          ).toISOString(),
        });
      }

      const result = await call({ author: "volunteer-uid", limit: 1 });

      expect(result.truncated).toBe(true);
    });

    it("does not claim to be truncated when the scan fit", async () => {
      for (let i = 0; i < AUTHOR_SCAN_CAP - 1; i++) {
        addRevision(`rev-${i}`, {
          update_time: new Date(
            Date.UTC(2026, 0, 1) + i * 60_000,
          ).toISOString(),
        });
      }

      const result = await call({ author: "volunteer-uid", limit: 1 });

      expect(result.truncated).toBe(false);
    });
  });

  describe("the permalinked proposal", () => {
    it("answers it alongside a page it is not on", async () => {
      // A permalink has to keep resolving after the decision is made, and a
      // decided proposal is on none of the pending pages.
      addRevision("rev-pending");
      addRevision("rev-decided", {
        status: "rejected",
        reject_reason: "Nie ma na to źródła.",
        update_time: "2026-08-09T09:00:00.000Z",
      });

      const result = await call({ revision: "rev-decided" });

      expect(ids(result.revisions)).toEqual(["rev-pending"]);
      expect(result.pinned?.id).toBe("rev-decided");
      expect(result.pinned?.status).toBe("rejected");
    });

    it("does not repeat one that is already on the page", async () => {
      addRevision("rev-pending");

      const result = await call({ revision: "rev-pending" });

      expect(ids(result.revisions)).toEqual(["rev-pending"]);
      expect(result.pinned).toBeNull();
    });

    it("answers null for an id that does not exist", async () => {
      addRevision("rev-pending");

      const result = await call({ revision: "rev-nonsense" });

      expect(result.pinned).toBeNull();
    });
  });

  it("never lets a proxy or the browser keep the answer", async () => {
    addRevision("rev-1");

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  describe("what a row says about its target", () => {
    it("links a node revision to the page it would change", async () => {
      // A published entry points at the revision it is serving, and that
      // snapshot - not the stored document - is what a proposal is a change to.
      approveOnto("node-1", "rev-approved", {
        name: "Anna Nowak",
        type: "person",
        content: "Stary opis.",
      });
      addRevision("rev-1");

      const result = await call();

      const row = result.revisions.find((r) => r.id === "rev-1");
      expect(row!.targetExists).toBe(true);
      expect(row!.targetCollection).toBe("nodes");
      expect(row!.targetName).toBe("Anna Nowak");
      expect(row!.targetType).toBe("person");
      expect(row!.targetPath).toBe("/osoba/anna-nowak-node-1");
      expect(row!.published).toBe(true);
      expect(row!.kind).toBe("edit");
      expect(row!.changes).toEqual([
        {
          field: "content",
          label: "opis",
          from: "Stary opis.",
          to: "Nowy opis.",
        },
      ]);
    });

    it("reads every field as new while nothing has been approved yet", async () => {
      // `/api/revisions/create` writes the proposal's own data onto the node in
      // the batch that files it, so the stored document already agrees with the
      // revision. Diffing against it would report no changes at all for a
      // proposal that is entirely new - which is what the queue is for.
      addRevision("rev-1");

      const result = await call();

      const [row] = result.revisions;
      expect(row!.kind).toBe("create");
      expect(row!.changes.map((change) => change.field).sort()).toEqual([
        "content",
        "name",
      ]);
      expect(row!.changes.every((change) => change.from === null)).toBe(true);
    });

    it("says so, rather than linking, when the target is gone", async () => {
      // A proposal against a deleted entry can never be approved onto
      // anything; rendering it as a link would read as a broken page.
      addRevision("rev-1", { node_id: "node-gone" });

      const result = await call();

      const [row] = result.revisions;
      expect(row!.targetExists).toBe(false);
      expect(row!.targetPath).toBeNull();
      expect(row!.published).toBe(false);
    });

    it("gives a relation no page of its own", async () => {
      addRevision("rev-1", {
        node_id: "edge-1",
        collection: "edges",
        data: {
          source: "node-1",
          target: "node-2",
          type: "employed",
          position: "prezes",
        },
      });
      targets["edges/edge-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
        position: "członek zarządu",
        published: true,
      };
      targets["nodes/node-2"] = { name: "Orlen", type: "place" };

      const result = await call();

      const [row] = result.revisions;
      expect(row!.targetCollection).toBe("edges");
      expect(row!.targetExists).toBe(true);
      // A relation has no page of its own, so it is named after the two entries
      // it joins and linked to the one it will show up on - which is also what
      // the notification email about the same proposal says.
      expect(row!.targetName).toBe("Anna Nowak → Orlen");
      expect(row!.targetPath).toBe("/osoba/anna-nowak-node-1");
      // The endpoints are what the relation is, not what is being proposed.
      expect(row!.changes).toEqual([
        {
          field: "position",
          label: "stanowisko",
          from: null,
          to: "prezes",
        },
      ]);
    });

    it("shows the first few changes and counts the rest", async () => {
      addRevision("rev-1", {
        data: {
          name: "Anna Kowalska",
          type: "person",
          content: "Nowy opis.",
          birthDate: "1970-01-01",
          wikipedia: "https://pl.wikipedia.org/wiki/Anna",
          rejestrIo: "https://rejestr.io/1",
          ktomaco: "https://ktomaco.pl/1",
          parties: ["PiS"],
        },
      });

      const result = await call();

      expect(result.revisions[0]!.changeCount).toBe(7);
      expect(result.revisions[0]!.changes).toHaveLength(6);
    });
  });

  describe("whether approving would write over something newer", () => {
    it("marks a proposal the target has moved past", async () => {
      // `applyRevision` writes with `set`, so approving this would undo the
      // edit that landed on 2026-08-05.
      addRevision("rev-1", { update_time: "2026-08-01T09:00:00.000Z" });
      addRevision("rev-2", {
        status: "approved",
        update_time: "2026-08-05T09:00:00.000Z",
      });
      targets["nodes/node-1"] = {
        name: "Anna Nowak",
        type: "person",
        published: true,
        revision_id: "rev-2",
      };

      const result = await call();

      expect(ids(result.revisions)).toEqual(["rev-1"]);
      expect(result.revisions[0]!.stale).toBe(true);
      expect(result.revisions[0]!.status).toBe("pending");
    });

    it("leaves a proposal newer than the approved version alone", async () => {
      addRevision("rev-1", { update_time: "2026-08-05T09:00:00.000Z" });
      addRevision("rev-0", {
        status: "approved",
        update_time: "2026-07-01T09:00:00.000Z",
      });
      targets["nodes/node-1"] = {
        name: "Anna Nowak",
        type: "person",
        published: true,
        revision_id: "rev-0",
      };

      const result = await call();

      expect(result.revisions[0]!.stale).toBe(false);
    });

    it("never calls the approved revision stale against itself", async () => {
      addRevision("rev-1", { update_time: "2026-08-05T09:00:00.000Z" });
      targets["nodes/node-1"] = {
        name: "Anna Nowak",
        type: "person",
        published: true,
        revision_id: "nodes/node-1/revisions/rev-1",
      };

      const result = await call({ status: "all" });

      const [row] = result.revisions;
      expect(row!.stale).toBe(false);
      // Stored as pending, but the node is serving it, so it is approved -
      // worked out from the target rather than read off the revision.
      expect(row!.status).toBe("approved");
      expect(row!.statusDerived).toBe(true);
    });

    it("calls an approved version the target left behind superseded", async () => {
      addRevision("rev-1", {
        status: "approved",
        update_time: "2026-08-01T09:00:00.000Z",
      });
      targets["nodes/node-1"] = {
        name: "Anna Nowak",
        type: "person",
        published: true,
        revision_id: "rev-2",
      };

      const result = await call({ status: "approved" });

      expect(result.revisions[0]!.status).toBe("superseded");
      expect(result.revisions[0]!.statusDerived).toBe(true);
    });
  });

  describe("who filed it", () => {
    it("resolves the author for the reviewer", async () => {
      addRevision("rev-1");
      mockGetUsers.mockResolvedValue({
        users: [
          {
            uid: "volunteer-uid",
            displayName: "Anna Nowak",
            email: "anna@example.com",
            photoURL: null,
          },
        ],
      });

      const result = await call();

      expect(result.revisions[0]!.updateUser).toBe("volunteer-uid");
      expect(result.revisions[0]!.author).toEqual({
        displayName: "Anna Nowak",
        email: "anna@example.com",
        photoURL: null,
      });
    });

    it("keeps the row when the uid no longer resolves", async () => {
      // Dropping it would quietly shrink the queue by however many accounts
      // have been deleted since.
      addRevision("rev-1");
      mockGetUsers.mockResolvedValue({ users: [] });

      const result = await call();

      expect(ids(result.revisions)).toEqual(["rev-1"]);
      expect(result.revisions[0]!.author).toBeNull();
    });
  });
  describe("what a proposal is about", () => {
    /** An edge revision between two nodes, with both of them stored. */
    function addRelation(
      id: string,
      ends: { source: string; target: string; type?: string },
      overrides: Data = {},
    ) {
      addRevision(id, {
        node_id: `edge-${id}`,
        collection: "edges",
        data: { type: ends.type ?? "employed", ...ends },
        ...overrides,
      });
      targets[`edges/edge-${id}`] = { ...ends, published: false };
    }

    beforeEach(() => {
      targets["nodes/person-1"] = {
        name: "Anna Nowak",
        type: "person",
        published: true,
      };
      targets["nodes/place-1"] = {
        name: "Wodociągi",
        type: "place",
        published: true,
      };
      targets["nodes/article-1"] = {
        name: "Artykuł o radzie",
        type: "article",
        published: true,
      };
      targets["nodes/region-1"] = {
        name: "Gmina Przykładowo",
        type: "region",
        published: false,
      };
    });

    it("is the entry itself for a node revision", async () => {
      addRevision("rev-1");

      const [row] = (await call()).revisions;

      expect(row!.subject).toEqual({
        id: "node-1",
        name: "Anna Nowak",
        type: "person",
        path: "/osoba/anna-nowak-node-1",
        published: true,
      });
    });

    it("is the person at either end of a relation", async () => {
      // A seat on a board is filed under the person; a mention, under the
      // article - but it is the person a reviewer is going through.
      addRelation("employed", { source: "person-1", target: "place-1" });
      addRelation(
        "mention",
        { source: "article-1", target: "person-1", type: "mentions" },
        { update_time: "2026-08-09T09:00:00.000Z" },
      );

      const result = await call();

      expect(result.revisions.map((row) => row.subject.id)).toEqual([
        "person-1",
        "person-1",
      ]);
      expect(result.revisions[0]!.subject).toMatchObject({
        name: "Anna Nowak",
        type: "person",
        published: true,
      });
    });

    it("is the source of a relation between two entries that are not people", async () => {
      addRelation("seat", {
        source: "region-1",
        target: "place-1",
        type: "seat",
      });

      const [row] = (await call()).revisions;

      expect(row!.subject).toMatchObject({ id: "region-1", published: false });
    });

    it("is the relation itself, never live, when neither end can be read", async () => {
      addRelation("orphan", { source: "gone-1", target: "gone-2" });

      const [row] = (await call()).revisions;

      expect(row!.subject).toMatchObject({
        id: "edge-orphan",
        type: null,
        published: false,
      });
    });
  });

  describe("by the entry a proposal is about", () => {
    /** Three people, one of them live, with proposals about each. */
    beforeEach(() => {
      targets["nodes/live"] = {
        name: "Barbara Opublikowana",
        type: "person",
        published: true,
      };
      targets["nodes/draft"] = {
        name: "Cezary Szkicowy",
        type: "person",
        published: false,
      };
      targets["nodes/place-1"] = { name: "Wodociągi", type: "place" };
      addRevision("live-old", {
        node_id: "live",
        update_time: "2026-08-01T09:00:00.000Z",
      });
      addRevision("draft-new", {
        node_id: "draft",
        update_time: "2026-08-05T09:00:00.000Z",
      });
      // A relation is about the person at its source, so it joins her group.
      addRevision("live-relation", {
        node_id: "edge-1",
        collection: "edges",
        data: { type: "employed", source: "live", target: "place-1" },
        update_time: "2026-08-04T09:00:00.000Z",
      });
      addRevision("draft-old", {
        node_id: "draft",
        update_time: "2026-07-30T09:00:00.000Z",
      });
    });

    it("lists only proposals about a live page when asked for published", async () => {
      const result = await call({ published: "true" });

      expect(ids(result.revisions)).toEqual(["live-relation", "live-old"]);
      expect(result.total).toBe(2);
      // The same two clauses as the plain queue, read whole and masked to what
      // names a target - nothing about the target can go in the query.
      expect(mockWhere).toHaveBeenCalledWith("update_automatic", "==", false);
      expect(mockWhere).toHaveBeenCalledWith("status", "==", "pending");
      expect(mockOffset).not.toHaveBeenCalled();
      expect(mockSelect).toHaveBeenCalledWith(
        "node_id",
        "nodeId",
        "collection",
        "data.source",
        "data.target",
      );
      expect(result.flagOnly).toBe(true);
    });

    it("and only the drafts' when asked for unpublished", async () => {
      const result = await call({ published: "false" });

      expect(ids(result.revisions)).toEqual(["draft-new", "draft-old"]);
    });

    it("groups the proposals by entry, newest entry first", async () => {
      const result = await call({ group: "subject" });

      expect(result.revisions).toEqual([]);
      expect(result.total).toBe(4);
      expect(result.groupTotal).toBe(2);
      expect(
        result.groups!.map((group) => [
          group.subject.id,
          group.count,
          ids(group.proposals),
        ]),
      ).toEqual([
        ["draft", 2, ["draft-new", "draft-old"]],
        ["live", 2, ["live-relation", "live-old"]],
      ]);
      expect(result.groups![1]!.subject).toMatchObject({
        name: "Barbara Opublikowana",
        published: true,
      });
    });

    it("pages through entries rather than proposals when grouped", async () => {
      const result = await call({ group: "subject", limit: 1, page: 2 });

      expect(result.groups!.map((group) => group.subject.id)).toEqual(["live"]);
      expect(result.groupTotal).toBe(2);
    });

    it("groups the live entries alone with both set", async () => {
      const result = await call({ group: "subject", published: "true" });

      expect(result.groups!.map((group) => group.subject.id)).toEqual(["live"]);
      expect(result.total).toBe(2);
    });

    it("reads the list once for a couple of minutes, and every page fresh", async () => {
      await call({ published: "true" });
      const firstScan = mockSelect.mock.calls.length;

      // Decided elsewhere - by another admin, on another instance - after the
      // list was read: the scan still holds it, the page must not.
      revisions["live-old"]!.status = "approved";
      const result = await call({ published: "true" });

      expect(mockSelect.mock.calls.length).toBe(firstScan);
      expect(ids(result.revisions)).toEqual(["live-relation"]);
    });

    it("drops a proposal decided here from the list it holds", async () => {
      await call({ published: "true" });

      revisions["live-old"]!.status = "rejected";
      forgetQueued("live-old", "rejected");
      const result = await call({ published: "true" });

      expect(result.total).toBe(1);
      expect(ids(result.revisions)).toEqual(["live-relation"]);
    });

    it("filters and groups one author's history the same way", async () => {
      const result = await call({
        author: "volunteer-uid",
        group: "subject",
        published: "true",
      });

      expect(result.groups!.map((group) => group.subject.id)).toEqual(["live"]);
      expect(ids(result.groups![0]!.proposals)).toEqual([
        "live-relation",
        "live-old",
      ]);
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("answers a permalink that is inside one of the groups as already there", async () => {
      const result = await call({ group: "subject", revision: "live-old" });

      expect(result.pinned).toBeNull();
    });
  });
});

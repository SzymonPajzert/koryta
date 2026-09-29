import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  AUTHOR_SCAN_CAP,
  type RevisionQueue,
} from "../../../../server/api/revisions/queue.get";

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

/** Firestore's `==`, including the half of it this endpoint turns on: a
 * document that does not carry the field at all matches no equality. */
function equals(data: Data, field: string, value: unknown): boolean {
  return field in data && data[field] === value;
}

/** A query over `docs`, recorded so a test can assert the clause and applied
 * for real so it also sees the rows that clause would return. */
function queryOver(docs: Snapshot[]) {
  return {
    where(field: string, op: string, value: unknown) {
      mockWhere(field, op, value);
      if (op !== "==") throw new Error(`the fake only knows "==", not "${op}"`);
      return queryOver(
        docs.filter((doc) => equals(doc.data() ?? {}, field, value)),
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
          start_date: "2019-03-01",
        },
      });
      targets["edges/edge-1"] = {
        source: "node-1",
        target: "node-2",
        type: "employed",
        start_date: "2018-01-01",
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
          field: "start_date",
          label: "data od",
          from: null,
          to: "2019-03-01",
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
});

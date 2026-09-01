import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  MINE_SCAN_CAP,
  type MyProposals,
} from "../../../../server/api/revisions/mine.get";

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
    limit(count: number) {
      mockLimit(count);
      return queryOver(docs.slice(0, count));
    },
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
  (handler as unknown as (event: unknown) => Promise<MyProposals>)({ query });

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A proposal the signed-in contributor filed, with the flag on it.
 *
 * An override of `undefined` removes the field rather than setting it to
 * nothing, which is how the 1,760 flagless revisions are stored.
 */
function addRevision(id: string, overrides: Data = {}) {
  const doc: Data = {
    node_id: "node-1",
    collection: "nodes",
    data: { name: "Anna Nowak", type: "person", content: "Nowy opis." },
    status: "pending",
    update_time: "2026-08-10T09:00:00.000Z",
    update_user: "me-uid",
    update_automatic: false,
    ...overrides,
  };
  revisions[id] = Object.fromEntries(
    Object.entries(doc).filter(([, value]) => value !== undefined),
  );
}

describe("api/revisions/mine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revisions = {};
    targets = {};
    headers.clear();
    mockGetUser.mockResolvedValue({ uid: "me-uid" });
    mockGetUsers.mockResolvedValue({ users: [] });
    targets["nodes/node-1"] = {
      name: "Anna Nowak",
      type: "person",
      content: "Stary opis.",
      published: true,
    };
  });

  it("reads the uid off the token and takes it from nowhere else", async () => {
    // There is no author parameter, so this cannot be turned into a way of
    // reading somebody else's record; anything the caller sends is dropped by
    // the validator.
    addRevision("rev-mine");
    addRevision("rev-theirs", { update_user: "other-uid" });

    const result = await call({
      author: "other-uid",
      update_user: "other-uid",
    });

    expect(mockWhere).toHaveBeenCalledWith("update_user", "==", "me-uid");
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledWith("update_time", "desc");
    expect(mockLimit).toHaveBeenCalledWith(MINE_SCAN_CAP);
    expect(ids(result.revisions)).toEqual(["rev-mine"]);
  });

  it("refuses a caller with no token", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("answers an ordinary signed-in contributor", async () => {
    // Nothing here is admin-only: the point of the page is that the person who
    // proposed a change finds out what came of it.
    addRevision("rev-mine");

    const result = await call();

    expect(ids(result.revisions)).toEqual(["rev-mine"]);
  });

  it("shows the older flagless proposals and hides the pipeline's", async () => {
    // `update_automatic !== true` in memory rather than a `where`, because an
    // equality would match none of the revisions that carry no flag - and
    // those are exactly the history a person's own record has to include.
    addRevision("rev-flagless", {
      update_automatic: undefined,
      update_time: "2026-07-01T09:00:00.000Z",
    });
    addRevision("rev-flagged", { update_time: "2026-08-01T09:00:00.000Z" });
    addRevision("rev-pipeline", {
      update_automatic: true,
      update_time: "2026-08-02T09:00:00.000Z",
    });

    const result = await call();

    expect(ids(result.revisions)).toEqual(["rev-flagged", "rev-flagless"]);
    expect(result.counts.pending).toBe(2);
  });

  describe("the summary chips", () => {
    beforeEach(() => {
      addRevision("rev-pending-1", { update_time: "2026-08-05T09:00:00.000Z" });
      addRevision("rev-pending-2", { update_time: "2026-08-04T09:00:00.000Z" });
      addRevision("rev-approved", {
        node_id: "node-approved",
        status: "approved",
        update_time: "2026-08-03T09:00:00.000Z",
      });
      addRevision("rev-superseded", {
        node_id: "node-superseded",
        status: "approved",
        update_time: "2026-08-02T09:00:00.000Z",
      });
      addRevision("rev-rejected", {
        status: "rejected",
        reject_reason: "Brak źródła dla tej zmiany.",
        review_time: "2026-08-06T09:00:00.000Z",
        update_time: "2026-08-01T09:00:00.000Z",
      });
      targets["nodes/node-approved"] = {
        name: "Jan Kowalski",
        type: "person",
        published: true,
        revision_id: "rev-approved",
      };
      targets["nodes/node-superseded"] = {
        name: "Maria Wiśniewska",
        type: "person",
        published: true,
        revision_id: "rev-newer",
      };
    });

    it("counts everything scanned, before the filter and before the page", async () => {
      // Otherwise the chips would move as the reader pages or narrows, which
      // reads as the numbers being wrong rather than as a filter working.
      const result = await call({ status: "pending", limit: 1 });

      expect(result.counts).toEqual({
        pending: 2,
        approved: 1,
        superseded: 1,
        rejected: 1,
      });
      // `total` is the filtered set, which is what paging walks through.
      expect(result.total).toBe(2);
      expect(ids(result.revisions)).toEqual(["rev-pending-1"]);
    });

    it("keeps the same counts on the second page", async () => {
      const result = await call({ status: "pending", limit: 1, page: 2 });

      expect(result.counts.pending).toBe(2);
      expect(result.total).toBe(2);
      expect(ids(result.revisions)).toEqual(["rev-pending-2"]);
    });

    it("tells a version the entry has moved past from a live one", async () => {
      // Calling a superseded version approved on the author's own page claims
      // their words are on the site when they are not.
      const result = await call({ status: "all" });

      const byId = new Map(result.revisions.map((row) => [row.id, row]));
      expect(byId.get("rev-approved")!.status).toBe("approved");
      expect(byId.get("rev-superseded")!.status).toBe("superseded");
    });

    it("reads a filter for approved as covering both", async () => {
      const result = await call({ status: "approved" });

      expect(ids(result.revisions)).toEqual(["rev-approved", "rev-superseded"]);
      expect(result.total).toBe(2);
    });

    it("carries the rejection reason on the row itself", async () => {
      const result = await call({ status: "rejected" });

      const [row] = result.revisions;
      expect(row!.rejectReason).toBe("Brak źródła dla tej zmiany.");
      expect(row!.reviewTime).toBe("2026-08-06T09:00:00.000Z");
    });
  });

  it("never tells the contributor who reviewed them", async () => {
    // The reviewing side is `redakcja` here as it is in the notification
    // emails, and this endpoint is open to everyone signed in - resolving
    // identities on it would be /api/users/lookup by another name.
    addRevision("rev-mine", { update_user: "me-uid" });

    const result = await call();

    expect(result.revisions[0]!.author).toBeNull();
    expect(mockGetUsers).not.toHaveBeenCalled();
  });

  it("says the answer is a lower bound once the scan hits its cap", async () => {
    for (let i = 0; i < MINE_SCAN_CAP; i++) {
      addRevision(`rev-${i}`, {
        update_time: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      });
    }

    const result = await call({ limit: 1 });

    expect(result.truncated).toBe(true);
  });

  it("does not claim to be truncated when the scan fit", async () => {
    for (let i = 0; i < MINE_SCAN_CAP - 1; i++) {
      addRevision(`rev-${i}`, {
        update_time: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      });
    }

    const result = await call({ limit: 1 });

    expect(result.truncated).toBe(false);
  });

  it("describes what the proposal would change, and what it points at", async () => {
    // The entry is serving an approved revision, and that snapshot - not the
    // stored document, which /api/revisions/create overwrites in the same batch
    // that files the proposal - is what the change is measured against.
    revisions["rev-approved"] = {
      node_id: "node-1",
      collection: "nodes",
      data: { name: "Anna Nowak", type: "person", content: "Stary opis." },
      status: "approved",
      update_time: "2026-01-01T00:00:00.000Z",
      review_time: "2026-01-01T00:00:00.000Z",
      update_user: "admin-uid",
      update_automatic: true,
    };
    targets["nodes/node-1"] = {
      ...targets["nodes/node-1"],
      revision_id: "revisions/rev-approved",
    };
    addRevision("rev-mine");

    const result = await call();

    const row = result.revisions.find((r) => r.id === "rev-mine");
    expect(row!.targetPath).toBe("/osoba/anna-nowak-node-1");
    expect(row!.targetExists).toBe(true);
    expect(row!.changes).toEqual([
      {
        field: "content",
        label: "opis",
        from: "Stary opis.",
        to: "Nowy opis.",
      },
    ]);
  });

  it("keeps a proposal whose entry has since been deleted", async () => {
    addRevision("rev-mine", { node_id: "node-gone" });

    const result = await call();

    const [row] = result.revisions;
    expect(row!.targetExists).toBe(false);
    expect(row!.targetPath).toBeNull();
    expect(row!.targetName).toBe("Anna Nowak");
  });

  it("never lets a proxy or the browser keep the answer", async () => {
    addRevision("rev-mine");

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  describe("narrowed to one entry", () => {
    it("keeps only what was proposed for that entry", async () => {
      // What the card on a company page asks, so that a contributor is shown
      // the change they just proposed instead of proposing it again.
      addRevision("rev-here");
      addRevision("rev-elsewhere", { node_id: "node-2" });
      targets["nodes/node-2"] = { name: "Inna Firma", type: "place" };

      const result = await call({ nodeId: "node-1" });

      expect(ids(result.revisions)).toEqual(["rev-here"]);
      expect(result.total).toBe(1);
      expect(result.counts.pending).toBe(1);
    });

    it("still narrows the scan by uid alone, and asks for no index", async () => {
      // A `where` on the target next to the uid equality and the ordering
      // would want a composite index; the scan is capped at 300 either way.
      addRevision("rev-here");

      await call({ nodeId: "node-1" });

      expect(mockWhere).toHaveBeenCalledTimes(1);
      expect(mockWhere).toHaveBeenCalledWith("update_user", "==", "me-uid");
    });

    it("finds a revision that spells the target the old way", async () => {
      // `/api/revisions/byNode` queries both spellings, and a filter that only
      // knew `node_id` would drop the older half of somebody's record.
      addRevision("rev-old", { node_id: undefined, nodeId: "node-1" });

      const result = await call({ nodeId: "node-1" });

      expect(ids(result.revisions)).toEqual(["rev-old"]);
    });

    it("answers with nothing for an entry this user never touched", async () => {
      addRevision("rev-here");

      const result = await call({ nodeId: "node-2" });

      expect(result.revisions).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});

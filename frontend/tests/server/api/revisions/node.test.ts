import { describe, it, expect, vi, beforeEach } from "vitest";
import handler, {
  type NodeRevisionHistory,
} from "../../../../server/api/revisions/node.get";

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

/** Firestore's `==`: a document without the field matches no equality, which
 * is the whole reason both spellings have to be asked for. */
function queryOver(docs: Snapshot[]) {
  return {
    where(field: string, op: string, value: unknown) {
      mockWhere(field, op, value);
      if (op !== "==") throw new Error(`the fake only knows "==", not "${op}"`);
      return queryOver(
        docs.filter((doc) => {
          const data = doc.data() ?? {};
          return field in data && data[field] === value;
        }),
      );
    },
    get: async () => ({ docs, size: docs.length, empty: docs.length === 0 }),
  };
}

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
  getAll: vi.fn(async (...args: unknown[]) =>
    args
      .filter(
        (arg): arg is { id: string; path: string } =>
          !!arg && typeof (arg as { path?: unknown }).path === "string",
      )
      .map((ref) => snapshotOf(ref.id, documentAt(ref.path))),
  ),
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

const call = (query: Data = { nodeId: "node-1" }) =>
  (handler as unknown as (event: unknown) => Promise<NodeRevisionHistory>)({
    query,
  });

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A human proposal against `node-1`. An override of `undefined` removes the
 * field, which is how the older documents are stored. */
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

const ANNA = {
  uid: "volunteer-uid",
  displayName: "Anna Nowak",
  email: "anna@example.com",
  photoURL: null,
};

describe("api/revisions/node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revisions = {};
    targets = {};
    headers.clear();
    mockGetUser.mockResolvedValue({ uid: "admin-uid", admin: true });
    mockGetUsers.mockResolvedValue({ users: [ANNA] });
    targets["nodes/node-1"] = {
      name: "Anna Nowak",
      type: "person",
      content: "Stary opis.",
      published: true,
    };
  });

  it("refuses a caller with no token at all", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("refuses a request that names no entry", async () => {
    await expect(call({})).rejects.toThrow();
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("never lets a proxy or the browser keep the answer", async () => {
    addRevision("rev-1");

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("reads both spellings of the target, once each", async () => {
    // The older documents say `nodeId`; a history that asked only for
    // `node_id` would start partway through. A document carrying both must
    // not turn up twice.
    addRevision("rev-underscore", { update_time: "2026-08-03T09:00:00.000Z" });
    addRevision("rev-camel", {
      node_id: undefined,
      nodeId: "node-1",
      update_time: "2026-08-02T09:00:00.000Z",
    });
    addRevision("rev-both", {
      nodeId: "node-1",
      update_time: "2026-08-01T09:00:00.000Z",
    });
    addRevision("rev-elsewhere", { node_id: "node-2" });

    const result = await call();

    expect(mockWhere).toHaveBeenCalledWith("node_id", "==", "node-1");
    expect(mockWhere).toHaveBeenCalledWith("nodeId", "==", "node-1");
    expect(ids(result.revisions)).toEqual([
      "rev-underscore",
      "rev-camel",
      "rev-both",
    ]);
  });

  it("puts the newest first and a revision with no time last", async () => {
    addRevision("rev-old", { update_time: "2026-01-01T09:00:00.000Z" });
    addRevision("rev-undated", { update_time: undefined });
    addRevision("rev-new", { update_time: "2026-09-01T09:00:00.000Z" });
    addRevision("rev-mid", { update_time: "2026-05-01T09:00:00.000Z" });

    const result = await call();

    expect(ids(result.revisions)).toEqual([
      "rev-new",
      "rev-mid",
      "rev-old",
      "rev-undated",
    ]);
  });

  it("names the author, and the reviewer, to an admin", async () => {
    addRevision("rev-1", {
      status: "rejected",
      reject_reason: "Brak źródła.",
      review_user: "admin-uid",
      review_time: "2026-08-11T09:00:00.000Z",
    });

    const [row] = (await call()).revisions;

    expect(row!.updateUser).toBe("volunteer-uid");
    expect(row!.author).toEqual({
      displayName: "Anna Nowak",
      email: "anna@example.com",
      photoURL: null,
    });
    expect(row!.reviewUser).toBe("admin-uid");
    expect(row!.reviewTime).toBe("2026-08-11T09:00:00.000Z");
    expect(row!.rejectReason).toBe("Brak źródła.");
  });

  it("answers any signed-in reader, but without names or emails", async () => {
    // Contributors are sent here from the entry's page; the revisions are
    // world-readable anyway. Who they are is not - that is the admin-only
    // /api/users/lookup's business.
    mockGetUser.mockResolvedValue({ uid: "volunteer-uid" });
    addRevision("rev-1", { review_user: "admin-uid" });

    const [row] = (await call()).revisions;

    expect(mockGetUsers).not.toHaveBeenCalled();
    expect(row!.updateUser).toBe("volunteer-uid");
    expect(row!.author).toBeNull();
    expect(row!.reviewUser).toBeNull();
  });

  it("lists every changed field, not the queue's first six", async () => {
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

    const [row] = (await call()).revisions;

    expect(row!.changeCount).toBe(7);
    expect(row!.changes).toHaveLength(7);
  });

  it("calls an overtaken approval superseded and the served one approved", async () => {
    // The comparison page used to say "Oczekuje" for the first of these,
    // which sent reviewers looking for a decision that had been made.
    addRevision("rev-old", {
      status: "approved",
      update_time: "2026-07-01T09:00:00.000Z",
    });
    addRevision("rev-live", {
      status: "approved",
      update_time: "2026-08-01T09:00:00.000Z",
    });
    addRevision("rev-waiting", { update_time: "2026-09-01T09:00:00.000Z" });
    targets["nodes/node-1"]!.revision_id = "revisions/rev-live";

    const result = await call();

    expect(
      Object.fromEntries(result.revisions.map((row) => [row.id, row.status])),
    ).toEqual({
      "rev-waiting": "pending",
      "rev-live": "approved",
      "rev-old": "superseded",
    });
    expect(result.approvedRevisionId).toBe("rev-live");
    expect(result.published).toBe(true);
    expect(result.exists).toBe(true);
  });

  it("answers for an entry that was never created", async () => {
    addRevision("rev-1", { node_id: "node-gone" });

    const result = await call({ nodeId: "node-gone" });

    expect(ids(result.revisions)).toEqual(["rev-1"]);
    expect(result.exists).toBe(false);
    expect(result.published).toBe(false);
    expect(result.approvedRevisionId).toBeNull();
  });

  it("answers an entry with no revisions with an empty list", async () => {
    const result = await call();

    expect(result.revisions).toEqual([]);
    expect(result.exists).toBe(true);
  });
});

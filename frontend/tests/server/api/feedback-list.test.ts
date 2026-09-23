import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/list.get";
import type { Feedback, FeedbackStatus } from "../../../shared/model";

const { mockGetUser, mockGetFirestore } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);

  return {
    mockGetUser: vi.fn(),
    mockGetFirestore: vi.fn(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: mockGetFirestore,
}));

/** A report as stored: no `id` field, the id is the document's. */
type Stored = Omit<Feedback, "id">;

type Where = [string, string, unknown];

/** What one query was built from, so a test can ask which filter, order and
 * limit the handler put on the open read and on the settled one. */
type RecordedQuery = {
  wheres: Where[];
  orderBys: [string, string | undefined][];
  limits: number[];
};

/** The `feedback` collection, keyed by document id. The fake evaluates the
 * handler's `in` filter, `orderBy` and `limit` against it rather than handing
 * back a canned list per query, so a limit put on the wrong query shows up as
 * reports going missing, the way it would against Firestore. */
const store = new Map<string, Stored>();
const queries: RecordedQuery[] = [];
const docLookups: string[] = [];

function snapshot(id: string, data: Stored | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

function run(recorded: RecordedQuery) {
  let rows = [...store.entries()];
  for (const [field, op, value] of recorded.wheres) {
    if (op !== "in" || !Array.isArray(value)) {
      throw new Error(`fake Firestore: unsupported where(${field}, ${op})`);
    }
    rows = rows.filter(([, data]) =>
      value.includes((data as Record<string, unknown>)[field]),
    );
  }
  for (const [field, direction] of [...recorded.orderBys].reverse()) {
    rows.sort(([, a], [, b]) => {
      const order = String((a as Record<string, unknown>)[field]).localeCompare(
        String((b as Record<string, unknown>)[field]),
      );
      return direction === "desc" ? -order : order;
    });
  }
  const limit = recorded.limits.at(-1);
  if (limit !== undefined) rows = rows.slice(0, limit);
  return rows.map(([id, data]) => snapshot(id, data));
}

function makeQuery(recorded: RecordedQuery) {
  const query = {
    where: (...w: Where) => {
      recorded.wheres.push(w);
      return query;
    },
    orderBy: (field: string, direction?: string) => {
      recorded.orderBys.push([field, direction]);
      return query;
    },
    limit: (n: number) => {
      recorded.limits.push(n);
      return query;
    },
    get: async () => {
      const docs = run(recorded);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return query;
}

function startQuery() {
  const recorded: RecordedQuery = { wheres: [], orderBys: [], limits: [] };
  queries.push(recorded);
  return makeQuery(recorded);
}

const mockDb = {
  collection: (name: string) => {
    if (name !== "feedback") {
      throw new Error(`unexpected collection ${name}`);
    }
    return {
      where: (...w: Where) => startQuery().where(...w),
      orderBy: (field: string, direction?: string) =>
        startQuery().orderBy(field, direction),
      limit: (n: number) => startQuery().limit(n),
      doc: (id: string) => {
        docLookups.push(id);
        return { id, get: async () => snapshot(id, store.get(id)) };
      },
    };
  },
};

/** The statuses a query's `where("adminStatus", "in", …)` asked for. */
const statusesOf = (query: RecordedQuery) =>
  (query.wheres.find(
    ([field, op]) => field === "adminStatus" && op === "in",
  )?.[2] ?? []) as FeedbackStatus[];

/** The read for the queue: the one asking for "new" reports. */
const openQuery = () => {
  const found = queries.find((q) => statusesOf(q).includes("new"));
  if (!found) throw new Error("the handler made no query for open reports");
  return found;
};

/** The read for history: the one asking for "resolved" reports. */
const settledQuery = () => {
  const found = queries.find((q) => statusesOf(q).includes("resolved"));
  if (!found) throw new Error("the handler made no query for settled reports");
  return found;
};

/** A report created `minutesAgo` before a fixed moment, so fixtures sort by
 * `createdAt` the way their numbering suggests. */
function report(
  status: FeedbackStatus,
  minutesAgo: number,
  extra: Partial<Stored> = {},
): Stored {
  return {
    kind: "bug",
    message: `Zgłoszenie sprzed ${minutesAgo} min`,
    context: { route: "/osoba/jan-testowy" },
    createdAt: new Date(
      Date.UTC(2026, 8, 23, 12, 0) - minutesAgo * 60_000,
    ).toISOString(),
    adminStatus: status,
    ...extra,
  };
}

/** Puts `count` reports with ids `${prefix}-0`…, the lower index the newer. */
function seed(prefix: string, count: number, status: FeedbackStatus) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${i}`;
    store.set(id, report(status, i));
    ids.push(id);
  }
  return ids;
}

type Result = { feedback: Feedback[]; openTruncated: boolean };

const callHandler = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<Result>)({ query });

const ids = (result: Result) => result.feedback.map((item) => item.id);

describe("GET /api/feedback/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetFirestore.mockReturnValue(mockDb);
    store.clear();
    queries.length = 0;
    docLookups.length = 0;
  });

  it("refuses a caller who is not an admin", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader-1", admin: false });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });

    // `feedback` has no rules block; this route is the only guard in front of
    // it, so nothing may be read before the check.
    expect(queries).toHaveLength(0);
    expect(docLookups).toHaveLength(0);
  });

  it("reads the koryta-pl database", async () => {
    await callHandler();

    expect(mockGetFirestore).toHaveBeenCalledWith("koryta-pl");
  });

  it("returns every open report, whatever the limit", async () => {
    // Older than any settled one, so a limit applied across both would cut
    // exactly these - the oldest entries of the queue - first.
    for (let i = 0; i < 150; i++) {
      store.set(
        `open-${i}`,
        report(i % 3 === 0 ? "in_progress" : "new", 10_000 + i),
      );
    }
    seed("settled", 120, "resolved");

    const result = await callHandler({ limit: "100" });

    const open = result.feedback.filter((item) => item.id!.startsWith("open-"));
    expect(open).toHaveLength(150);
    expect(new Set(open.map((item) => item.id))).toEqual(
      new Set(Array.from({ length: 150 }, (_, i) => `open-${i}`)),
    );
    // The limit is for history only.
    expect(
      result.feedback.filter((item) => item.id!.startsWith("settled-")),
    ).toHaveLength(100);
    expect(result.openTruncated).toBe(false);
  });

  it("splits the statuses between the two reads without dropping one", async () => {
    await callHandler();

    // "w trakcie" is still work in the queue, so it is read with "new".
    expect([...statusesOf(openQuery())].sort()).toEqual(["in_progress", "new"]);
    expect([...statusesOf(settledQuery())].sort()).toEqual([
      "resolved",
      "wont_fix",
    ]);
    // A status neither read asks for would vanish from the page altogether.
    const asked = [
      ...statusesOf(openQuery()),
      ...statusesOf(settledQuery()),
    ].sort();
    expect(asked).toEqual(["in_progress", "new", "resolved", "wont_fix"]);
  });

  it("reads the newest settled reports, up to the limit", async () => {
    await callHandler({ limit: "25" });

    expect(settledQuery().orderBys).toEqual([["createdAt", "desc"]]);
    expect(settledQuery().limits).toEqual([25]);
  });

  it("defaults the settled limit to 100", async () => {
    await callHandler();

    expect(settledQuery().limits).toEqual([100]);
  });

  it("returns the newest settled reports rather than any of them", async () => {
    // Stored oldest first, so an insertion-order read would get this wrong.
    for (let i = 9; i >= 0; i--) {
      store.set(`settled-${i}`, report(i % 2 ? "wont_fix" : "resolved", i));
    }

    const result = await callHandler({ limit: "3" });

    expect(ids(result)).toEqual(["settled-0", "settled-1", "settled-2"]);
  });

  it("puts no order on the open read", async () => {
    await callHandler();

    // The page sorts the queue itself, and an `in` with an orderBy on another
    // field needs a composite index this read has no use for.
    expect(openQuery().orderBys).toEqual([]);
  });

  it("does not report a cut when the open reports fit under the cap", async () => {
    seed("open", 500, "new");

    const result = await callHandler();

    expect(result.feedback).toHaveLength(500);
    expect(result.openTruncated).toBe(false);
  });

  it("caps the open reports at 500 and says it did", async () => {
    seed("open", 501, "new");

    const result = await callHandler();

    // One past the cap is read only to learn that there is more.
    expect(openQuery().limits).toEqual([501]);
    expect(result.feedback).toHaveLength(500);
    expect(result.openTruncated).toBe(true);
  });

  it("returns each report with its document id", async () => {
    store.set("fb-open", report("new", 1, { queueRank: 2048 }));
    store.set("fb-closed", report("resolved", 2, { adminNote: "poprawione" }));

    const result = await callHandler();

    expect(result.feedback).toEqual([
      { id: "fb-open", ...store.get("fb-open") },
      { id: "fb-closed", ...store.get("fb-closed") },
    ]);
  });

  it("appends an old settled report named by include", async () => {
    seed("settled", 5, "resolved");
    // Older than the newest 5, so neither read returns it by itself.
    store.set("fb-old", report("wont_fix", 60 * 24 * 365));

    const result = await callHandler({ limit: "5", include: "fb-old" });

    expect(docLookups).toEqual(["fb-old"]);
    expect(ids(result).filter((id) => id === "fb-old")).toHaveLength(1);
    expect(result.feedback.at(-1)).toEqual({
      id: "fb-old",
      ...store.get("fb-old"),
    });
    expect(result.feedback).toHaveLength(6);
  });

  it.each([
    ["open", "new"],
    ["settled", "resolved"],
  ] as const)(
    "does not repeat an included report the %s read already returned",
    async (_, status) => {
      store.set("fb-1", report(status, 1));
      store.set("fb-2", report(status, 2));

      const result = await callHandler({ include: "fb-2" });

      expect(ids(result)).toEqual(["fb-1", "fb-2"]);
    },
  );

  it("adds nothing when the included report does not exist", async () => {
    store.set("fb-1", report("new", 1));

    const result = await callHandler({ include: "fb-gone" });

    // The page says "Nie ma takiego zgłoszenia." when the hash names nothing;
    // that is its call, not a 404 that would lose the rest of the list.
    expect(docLookups).toEqual(["fb-gone"]);
    expect(ids(result)).toEqual(["fb-1"]);
  });

  it("does not look anything up without include", async () => {
    await callHandler();

    expect(docLookups).toHaveLength(0);
  });

  // `doc("a/b")` is a path, not an id: it would address a document in a
  // subcollection, or in another collection altogether.
  it.each([
    ["a nested path", "fb-1/notes/x"],
    ["another collection", "../users/admin-1"],
    ["a bare slash", "/"],
    ["an id longer than Firestore allows here", "x".repeat(201)],
  ])("ignores an include that is %s", async (_, include) => {
    store.set("fb-1", report("new", 1));

    const result = await callHandler({ include });

    expect(docLookups).toHaveLength(0);
    // Ignored rather than refused, so a mangled link still opens the list.
    expect(ids(result)).toEqual(["fb-1"]);
  });

  it.each(["0", "201", "abc"])(
    "refuses a settled limit of %s",
    async (limit) => {
      await expect(callHandler({ limit })).rejects.toThrow();

      expect(queries).toHaveLength(0);
    },
  );
});

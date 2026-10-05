import { describe, it, expect, vi, beforeEach } from "vitest";
import listHandler from "../../../server/api/admin/users/index.get";
import detailHandler from "../../../server/api/admin/users/[uid].get";
import nominateHandler from "../../../server/api/admin/users/nominate.post";
import withdrawHandler from "../../../server/api/admin/users/withdraw.post";
import dismissHandler from "../../../server/api/admin/users/dismiss-request.post";
import type {
  AdminUserDetail,
  AdminUserRow,
  AdminUsersResponse,
} from "../../../shared/userAdmin";

/** The users page's routes, run against an in-memory Auth and Firestore.
 *
 * Faked at the token and the services, not at the gate: `requireEstablishedAdmin`
 * and the live claims read behind it are what decides who gets in, so they run
 * for real - a token that says `admin` is not enough when the account behind it
 * is on trial.
 */
const {
  accounts,
  tokens,
  tables,
  reads,
  commits,
  memo,
  contributors,
  fakeAuth,
  fakeDb,
  Timestamp,
} = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  /** Nitro's memo, cut down to what the routes rely on: one entry per name and
   * key until a test clears it. That is what lets a test show which reads are
   * memoized and which are not. */
  const memo = new Map<string, unknown>();
  g.defineCachedFunction =
    (
      fn: (...args: unknown[]) => unknown,
      options: { name: string; getKey?: (...args: unknown[]) => string },
    ) =>
    async (...args: unknown[]) => {
      const key = `${options.name}:${options.getKey?.(...args) ?? ""}`;
      if (!memo.has(key)) memo.set(key, await fn(...args));
      return memo.get(key);
    };

  /** Enough of Firestore's Timestamp to compare and be told apart. */
  class Timestamp {
    constructor(readonly millis: number) {}
    static fromMillis(millis: number) {
      return new Timestamp(millis);
    }
    static fromDate(date: Date) {
      return new Timestamp(date.getTime());
    }
    toMillis() {
      return this.millis;
    }
    toDate() {
      return new Date(this.millis);
    }
  }

  type Data = Record<string, unknown>;
  type Where = [string, string, unknown];
  type Shape = {
    wheres: Where[];
    orderBy: [string, "asc" | "desc"][];
    limit?: number;
    select?: string[];
  };
  type Write = {
    op: "set" | "update" | "create";
    collection: string;
    id: string;
    data: Data;
  };

  /** Documents by collection, then id. */
  const tables = new Map<string, Map<string, Data>>();
  const table = (name: string) => {
    let found = tables.get(name);
    if (!found) tables.set(name, (found = new Map()));
    return found;
  };

  /** Every read, with what it asked for. */
  const reads: {
    kind: "get" | "count" | "doc" | "getAll";
    collection: string;
    wheres?: Where[];
    limit?: number;
    select?: string[];
    fieldMask?: string[];
  }[] = [];
  /** Every committed batch or transaction, as its list of writes. */
  const commits: Write[][] = [];

  const comparable = (value: unknown) =>
    value instanceof Timestamp ? value.millis : value;
  const matches = (data: Data, [field, op, value]: Where) => {
    const a = comparable(data[field]) as number | string | boolean | undefined;
    const b = comparable(value) as number | string | boolean;
    if (op === "==") return a === b;
    // Like Firestore, a range never matches a document without the field.
    if (a === undefined) return false;
    if (op === ">=") return a >= b;
    if (op === "<=") return a <= b;
    if (op === ">") return a > b;
    if (op === "<") return a < b;
    throw new Error(`unexpected operator ${op}`);
  };
  const pick = (data: Data, fields: string[]) =>
    Object.fromEntries(
      Object.entries(data).filter(([field]) => fields.includes(field)),
    );

  const snapshot = (collection: string, id: string, data?: Data) => ({
    id,
    exists: data !== undefined,
    ref: docRef(collection, id),
    data: () => (data === undefined ? undefined : { ...data }),
    get: (field: string) => data?.[field],
  });

  let autoId = 0;
  function docRef(collection: string, id?: string) {
    const docId = id ?? `auto-${++autoId}`;
    return {
      id: docId,
      collection,
      path: `${collection}/${docId}`,
      get: async () => {
        reads.push({ kind: "doc", collection });
        return snapshot(collection, docId, table(collection).get(docId));
      },
    };
  }

  function query(
    collection: string,
    shape: Shape = { wheres: [], orderBy: [] },
  ) {
    const run = () => {
      const docs = [...table(collection)].filter(([, data]) =>
        shape.wheres.every((where) => matches(data, where)),
      );
      docs.sort(([, a], [, b]) => {
        for (const [field, direction] of shape.orderBy) {
          const [x, y] = [comparable(a[field]), comparable(b[field])] as [
            number,
            number,
          ];
          if (x !== y)
            return (x < y ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return 0;
      });
      return docs;
    };
    return {
      where: (field: string, op: string, value: unknown) =>
        query(collection, {
          ...shape,
          wheres: [...shape.wheres, [field, op, value]],
        }),
      orderBy: (field: string, direction: "asc" | "desc" = "asc") =>
        query(collection, {
          ...shape,
          orderBy: [...shape.orderBy, [field, direction]],
        }),
      limit: (limit: number) => query(collection, { ...shape, limit }),
      select: (...select: string[]) => query(collection, { ...shape, select }),
      count: () => ({
        get: async () => {
          reads.push({ kind: "count", collection, wheres: shape.wheres });
          const count = run().length;
          return { data: () => ({ count }) };
        },
      }),
      get: async () => {
        reads.push({
          kind: "get",
          collection,
          wheres: shape.wheres,
          limit: shape.limit,
          select: shape.select,
        });
        const docs = run()
          .slice(0, shape.limit)
          .map(([id, data]) =>
            snapshot(
              collection,
              id,
              shape.select ? pick(data, shape.select) : data,
            ),
          );
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
      doc: (id?: string) => docRef(collection, id),
    };
  }

  function apply(writes: Write[]) {
    for (const write of writes) {
      const exists = table(write.collection).has(write.id);
      if (write.op === "create" && exists) {
        throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      }
      if (write.op === "update" && !exists) {
        throw Object.assign(new Error("NOT_FOUND"), { code: 5 });
      }
    }
    for (const write of writes) {
      const rows = table(write.collection);
      rows.set(
        write.id,
        write.op === "update"
          ? { ...rows.get(write.id), ...write.data }
          : { ...write.data },
      );
    }
    commits.push(writes);
  }

  type Ref = { id: string; collection: string };
  function writer() {
    const writes: Write[] = [];
    const push = (op: Write["op"]) => (ref: Ref, data: Data) => {
      writes.push({ op, collection: ref.collection, id: ref.id, data });
    };
    return {
      writes,
      set: push("set"),
      update: push("update"),
      create: push("create"),
    };
  }

  const fakeDb = {
    collection: (name: string) => query(name),
    getAll: async (...args: unknown[]) => {
      const refs = args.filter(
        (arg): arg is Ref =>
          typeof arg === "object" && arg !== null && "collection" in arg,
      );
      const options = args.find(
        (arg): arg is { fieldMask: string[] } =>
          typeof arg === "object" && arg !== null && "fieldMask" in arg,
      );
      for (const ref of refs) {
        reads.push({
          kind: "getAll",
          collection: ref.collection,
          fieldMask: options?.fieldMask,
        });
      }
      return refs.map((ref) => {
        const data = table(ref.collection).get(ref.id);
        return snapshot(
          ref.collection,
          ref.id,
          data && options ? pick(data, options.fieldMask) : data,
        );
      });
    },
    batch: () => {
      const batch = writer();
      return { ...batch, commit: async () => apply(batch.writes) };
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = writer();
      const result = await fn({
        ...tx,
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        getAll: (...refs: unknown[]) => fakeDb.getAll(...refs),
      });
      apply(tx.writes);
      return result;
    },
  };

  /** Auth accounts, as `UserRecord`-shaped objects, by uid. */
  const accounts = new Map<string, Record<string, unknown>>();
  /** Bearer tokens and what they decode to. */
  const tokens = new Map<string, Record<string, unknown>>();
  const notFound = () =>
    Object.assign(new Error("no user"), { code: "auth/user-not-found" });

  const fakeAuth = {
    verifyIdToken: vi.fn(async (token: string) => {
      const decoded = tokens.get(token);
      if (!decoded) throw new Error("invalid token");
      return decoded;
    }),
    getUser: vi.fn(async (uid: string) => {
      const found = accounts.get(uid);
      if (!found) throw notFound();
      return found;
    }),
    getUsers: vi.fn(async (identifiers: { uid: string }[]) => ({
      users: identifiers
        .map(({ uid }) => accounts.get(uid))
        .filter((found) => found !== undefined),
      notFound: identifiers.filter(({ uid }) => !accounts.has(uid)),
    })),
    listUsers: vi.fn(async (max: number, pageToken?: string) => {
      const all = [...accounts.values()];
      const start = pageToken ? Number(pageToken) : 0;
      const end = start + max;
      return {
        users: all.slice(start, end),
        pageToken: end < all.length ? String(end) : undefined,
      };
    }),
  };

  return {
    accounts,
    tokens,
    tables,
    reads,
    commits,
    memo,
    /** `aggregate.contributors` of the 90-day activity window. */
    contributors: [] as {
      uid: string;
      counts: Record<string, number>;
      total: number;
      lastActiveAt: string;
    }[],
    fakeAuth,
    fakeDb,
    Timestamp,
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  type Event = {
    query?: unknown;
    body?: unknown;
    params?: Record<string, string>;
    sent: Record<string, string>;
  };
  // Like h3's own: whatever the validator throws comes back as a 400.
  const validated = async (data: unknown, parse: (d: unknown) => unknown) => {
    try {
      return await parse(data);
    } catch (cause) {
      throw Object.assign(new Error("Validation Error"), {
        statusCode: 400,
        cause,
      });
    }
  };
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: (event: Event, parse: (q: unknown) => unknown) =>
      validated(event.query ?? {}, parse),
    readValidatedBody: (event: Event, parse: (b: unknown) => unknown) =>
      validated(event.body, parse),
    getRouterParam: (event: Event, name: string) => event.params?.[name],
    setResponseHeader: (event: Event, name: string, value: string) => {
      event.sent[name] = value;
    },
  };
});

vi.mock("firebase-admin/auth", () => ({ getAuth: () => fakeAuth }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => fakeDb),
  Timestamp,
}));

// The 90-day window is its own memo with its own tests
// (stats-activity.test.ts); here it is just the counts the page joins on.
vi.mock("~~/server/utils/activityWindow", () => ({
  cachedActivityWindow: vi.fn(async () => ({
    aggregate: { contributors },
  })),
}));

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const iso = (millis: number) => new Date(millis).toISOString();
const daysAgo = (days: number) => iso(now - days * DAY);
const httpDate = (millis: number) => new Date(millis).toUTCString();

type Claims = Record<string, unknown>;

/** An Auth account, shaped like the admin SDK's `UserRecord`. */
function account(
  uid: string,
  fields: {
    displayName?: string | null;
    email?: string | null;
    emailVerified?: boolean;
    claims?: Claims;
    createdDaysAgo?: number;
    providers?: string[];
  } = {},
) {
  accounts.set(uid, {
    uid,
    displayName:
      fields.displayName === undefined ? `Konto ${uid}` : fields.displayName,
    email: fields.email === undefined ? `${uid}@example.com` : fields.email,
    emailVerified: fields.emailVerified ?? true,
    disabled: false,
    photoURL: undefined,
    providerData: (fields.providers ?? ["google.com"]).map((providerId) => ({
      providerId,
    })),
    metadata: {
      creationTime: httpDate(now - (fields.createdDaysAgo ?? 200) * DAY),
      lastSignInTime: httpDate(now - 20 * DAY),
      lastRefreshTime: null,
    },
    customClaims: fields.claims,
  });
}

const ADMIN = { trusted: true, datascience: true, admin: true };
const TRIAL = { ...ADMIN, newAdmin: true };
const OWNER = { ...ADMIN, owner: true };

/** Puts a document in place. */
function stored(collection: string, id: string, data: Record<string, unknown>) {
  let rows = tables.get(collection);
  if (!rows) tables.set(collection, (rows = new Map()));
  rows.set(id, data);
}
const doc = (collection: string, id: string) => tables.get(collection)?.get(id);
const rowsOf = (collection: string) => [
  ...(tables.get(collection)?.values() ?? []),
];

type Event = {
  headers: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
  sent: Record<string, string>;
};

/** A request from `uid`, whose token carries `claims` - the account's own by
 * default, which is what a fresh token would say. */
function as(uid: string | null, claims?: Claims): Event {
  if (uid === null) return { headers: {}, sent: {} };
  const token = `token-${uid}`;
  tokens.set(token, {
    uid,
    ...(claims ?? (accounts.get(uid)?.customClaims as Claims | undefined)),
  });
  return { headers: { authorization: `Bearer ${token}` }, sent: {} };
}

const call = <T>(handler: unknown, event: Event) =>
  (handler as (event: Event) => Promise<T>)(event);

const list = (event: Event, zakres?: string) =>
  call<AdminUsersResponse>(listHandler, {
    ...event,
    query: zakres ? { zakres } : {},
  });
const detail = (event: Event, uid: string) =>
  call<AdminUserDetail>(detailHandler, { ...event, params: { uid } });
const nominate = (event: Event, body: Record<string, unknown>) =>
  call<AdminUserRow>(nominateHandler, { ...event, body });
const withdraw = (event: Event, body: Record<string, unknown>) =>
  call<AdminUserRow>(withdrawHandler, { ...event, body });
const dismiss = (event: Event, body: Record<string, unknown>) =>
  call<AdminUserRow>(dismissHandler, { ...event, body });

/** A nomination document as the site or the script leaves it. */
function nomination(
  uid: string,
  desired: { level: string; trial?: boolean; by?: string },
  fields: Record<string, unknown> = {},
) {
  stored("roleNominations", uid, {
    desired: {
      level: desired.level,
      trial: desired.trial ?? false,
      reason: "Bo tak trzeba",
      by: desired.by ?? "boss",
      at: daysAgo(1),
    },
    applied: null,
    trialStartedAt: null,
    applyError: null,
    ...fields,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  accounts.clear();
  tokens.clear();
  tables.clear();
  reads.length = 0;
  commits.length = 0;
  memo.clear();
  contributors.length = 0;

  // Who is asking: the one established administrator, a second one, an
  // administrator on trial, and a member of the team without admin.
  account("boss", { displayName: "Szefowa", claims: ADMIN });
  account("colleague", { displayName: "Kolega", claims: ADMIN });
  account("trial", { displayName: "Nowa", claims: TRIAL });
  account("team", {
    displayName: "Zespół",
    claims: { trusted: true, datascience: true },
  });
});

/** The gate every route shares, asked of each of them. */
const routes: [string, (event: Event) => Promise<unknown>][] = [
  ["GET /api/admin/users", (event) => list(event)],
  ["GET /api/admin/users/[uid]", (event) => detail(event, "team")],
  [
    "POST /api/admin/users/nominate",
    (event) =>
      nominate(event, { uid: "team", level: "admin", reason: "Dobrze robi" }),
  ],
  [
    "POST /api/admin/users/withdraw",
    (event) => withdraw(event, { uid: "team" }),
  ],
  [
    "POST /api/admin/users/dismiss-request",
    (event) => dismiss(event, { uid: "team" }),
  ],
];

describe.each(routes)("%s: who may call it", (_route, run) => {
  beforeEach(() => {
    nomination("team", { level: "admin" });
    stored("accessRequests", "team", {
      reason: "Chcę pomagać przy imporcie",
      source: "pomoc",
      createdAt: daysAgo(2),
      status: "open",
      handledBy: null,
      handledAt: null,
      handledReason: null,
    });
  });

  it("refuses a caller with no token", async () => {
    await expect(run(as(null))).rejects.toMatchObject({ statusCode: 401 });
    expect(fakeAuth.listUsers).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
  });

  it("refuses a signed-in account that is not an administrator", async () => {
    account("reader");
    await expect(run(as("reader"))).rejects.toMatchObject({ statusCode: 403 });
    expect(fakeAuth.listUsers).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
  });

  it("refuses the team's tools without admin", async () => {
    await expect(run(as("team"))).rejects.toMatchObject({ statusCode: 403 });
    expect(commits).toEqual([]);
  });

  it("refuses an administrator on trial", async () => {
    // The person the page exists to keep an eye on: they would read every
    // address and could nominate their friends.
    await expect(run(as("trial"))).rejects.toMatchObject({
      statusCode: 403,
      message:
        "Ta strona jest dostępna tylko dla administratorów po okresie próbnym.",
    });
    expect(fakeAuth.listUsers).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
  });

  it("refuses a token older than the trial it was put on", async () => {
    // The token was issued before `newAdmin` was granted and still says
    // established; the account says otherwise, and the account wins.
    await expect(run(as("trial", ADMIN))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(commits).toEqual([]);
  });
});

describe("GET /api/admin/users", () => {
  /** A population with one of everything the default list keeps or drops. */
  function population() {
    account("nominee", { displayName: "Nominowana" });
    nomination("nominee", { level: "datascience" });

    account("trialist", { displayName: "Na próbie", claims: TRIAL });
    nomination(
      "trialist",
      { level: "admin", trial: true },
      {
        applied: {
          level: "admin",
          trial: true,
          at: daysAgo(12),
          by: "script:set_auth_claims@laptop",
        },
        trialStartedAt: daysAgo(12),
      },
    );

    account("asker", { displayName: "Prosząca" });
    stored("accessRequests", "asker", {
      reason: "Chcę pomagać przy imporcie",
      source: "rozszerzenie",
      createdAt: daysAgo(1),
      status: "open",
      handledBy: null,
      handledAt: null,
      handledReason: null,
    });

    account("visitor", { displayName: "Bywalec" });
    stored("userStats", "visitor", {
      firstSeenAt: daysAgo(40),
      lastSeenAt: daysAgo(3),
      lastActiveDay: daysAgo(3).slice(0, 10),
      activeDays: 9,
      signIns: 2,
      recentAuthTimes: [1, 2],
      lastProvider: "google.com",
    });

    account("worker", { displayName: "Pracowita" });
    contributors.push({
      uid: "worker",
      counts: { vote: 5, revision: 2, noteSource: 1, publication: 0 },
      total: 8,
      lastActiveAt: daysAgo(4),
    });

    account("newcomer", { displayName: "Nowicjusz", createdDaysAgo: 2 });
    account("dormant", { displayName: "Uśpiony", createdDaysAgo: 400 });

    // A pipeline login: an account, but not a person, and with no claim on
    // the account (its claims come in a custom token).
    account("pipeline-people-import", { displayName: null, email: null });
    // One that does hold a stored claim, which an administrator may need to
    // see and take away.
    account("pipeline-legacy", {
      displayName: null,
      email: null,
      claims: { trusted: true, datascience: true },
    });
  }

  beforeEach(population);

  it("lists the accounts that are part of the work, and not the rest", async () => {
    const event = as("boss");
    const response = await list(event);

    expect(response.scope).toBe("aktywni");
    expect(response.truncated).toBe(false);
    expect(response.users.map((row) => row.uid).sort()).toEqual(
      [
        "asker",
        "boss",
        "colleague",
        "newcomer",
        "nominee",
        "pipeline-legacy",
        "team",
        "trial",
        "trialist",
        "visitor",
        "worker",
      ].sort(),
    );
    // Addresses of every account: never cached anywhere but here.
    expect(event.sent["Cache-Control"]).toBe("private, no-store");
  });

  it("lists every account with ?zakres=wszyscy, robots labelled", async () => {
    const response = await list(as("boss"), "wszyscy");

    expect(response.scope).toBe("wszyscy");
    const byUid = new Map(response.users.map((row) => [row.uid, row]));
    expect(byUid.size).toBe(accounts.size);
    expect(byUid.get("dormant")?.robot).toBe(false);
    expect(byUid.get("pipeline-people-import")?.robot).toBe(true);
    expect(byUid.get("pipeline-legacy")).toMatchObject({
      robot: true,
      current: { level: "datascience", trial: false, owner: false },
    });
  });

  it("refuses a scope it does not know", async () => {
    await expect(list(as("boss"), "kazdy")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(fakeAuth.listUsers).not.toHaveBeenCalled();
  });

  it("joins the account, the nomination, sign-ins, activity and the request", async () => {
    stored("users", "visitor", {
      publicProfile: true,
      displayName: "x".repeat(10),
    });
    stored("profiles", "visitor", {
      handle: "bywalec",
      avatarImageId: null,
      hidden: null,
    });

    const { users } = await list(as("boss"));
    const byUid = new Map(users.map((row) => [row.uid, row]));

    expect(byUid.get("nominee")).toMatchObject({
      displayName: "Nominowana",
      email: "nominee@example.com",
      emailVerified: true,
      providers: ["google.com"],
      current: { level: "normal", trial: false, owner: false },
      nomination: {
        desired: {
          level: "datascience",
          trial: false,
          reason: "Bo tak trzeba",
          by: "boss",
          byName: "Szefowa",
        },
        pending: true,
        applyError: null,
      },
      robot: false,
    });
    // The Auth times, as ISO like everything else on the page.
    expect(byUid.get("nominee")?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(byUid.get("nominee")?.lastRefreshAt).toBeNull();

    expect(byUid.get("trialist")).toMatchObject({
      current: { level: "admin", trial: true },
      nomination: { pending: false },
      trialStartedAt: daysAgo(12),
    });
    expect(byUid.get("asker")?.accessRequest).toEqual({
      reason: "Chcę pomagać przy imporcie",
      source: "rozszerzenie",
      createdAt: daysAgo(1),
      status: "open",
    });
    expect(byUid.get("visitor")?.signIns).toEqual({
      count: 2,
      activeDays: 9,
      firstSeenAt: daysAgo(40),
      lastSeenAt: daysAgo(3),
    });
    expect(byUid.get("visitor")?.profile).toEqual({
      handle: "bywalec",
      public: true,
      hidden: false,
    });
    expect(byUid.get("worker")?.activity).toEqual({
      counts: { vote: 5, revision: 2, noteSource: 1, publication: 0 },
      total: 8,
      lastActiveAt: daysAgo(4),
    });
    expect(byUid.get("worker")?.profile).toEqual({
      handle: null,
      public: false,
      hidden: false,
    });
  });

  it("reads users/{uid} only through a mask, and only for the rows it sends", async () => {
    // The document is writable by its owner with no constraint on shape, so
    // nothing but the one boolean may come out of it.
    stored("users", "dormant", { publicProfile: true });
    await list(as("boss"));

    const userReads = reads.filter((read) => read.collection === "users");
    expect(userReads.length).toBeGreaterThan(0);
    expect(
      userReads.every((read) => read.fieldMask?.join() === "publicProfile"),
    ).toBe(true);
    // `dormant` is not on the default list, so its document is not read.
    expect(userReads.length).toBe(11);
  });

  it("reads the small collections with only the fields a row shows", async () => {
    await list(as("boss"));

    const whole = reads.filter((read) => read.kind === "get");
    expect(
      Object.fromEntries(whole.map((read) => [read.collection, read.select])),
    ).toEqual({
      roleNominations: ["desired", "trialStartedAt", "applyError"],
      userStats: ["signIns", "activeDays", "firstSeenAt", "lastSeenAt"],
      accessRequests: ["reason", "source", "createdAt", "status"],
      profiles: ["handle", "hidden"],
    });
    expect(whole.every((read) => read.limit === 10_000)).toBe(true);
  });

  it("walks Auth once per five minutes, but shows a new nomination at once", async () => {
    await list(as("boss"));
    expect(fakeAuth.listUsers).toHaveBeenCalledTimes(1);

    nomination("worker", { level: "trusted", by: "colleague" });
    const { users } = await list(as("boss"));

    expect(fakeAuth.listUsers).toHaveBeenCalledTimes(1);
    expect(users.find((row) => row.uid === "worker")?.nomination).toMatchObject(
      {
        desired: { level: "trusted", by: "colleague", byName: "Kolega" },
        pending: true,
      },
    );
  });

  it("says a nomination is no longer pending as soon as the script applied it", async () => {
    await list(as("boss"));
    // The script ran: the claims changed on the account, which the memoized
    // walk does not know yet.
    (accounts.get("nominee") as { customClaims?: Claims }).customClaims = {
      trusted: true,
      datascience: true,
    };

    const { users } = await list(as("boss"));
    const nominee = users.find((row) => row.uid === "nominee");
    expect(nominee?.current.level).toBe("datascience");
    expect(nominee?.nomination?.pending).toBe(false);
  });

  it("shows a request from an account the memo has not seen yet", async () => {
    await list(as("boss"));
    account("brand-new", { displayName: "Świeża" });
    stored("accessRequests", "brand-new", {
      reason: "Właśnie się zarejestrowałam",
      source: "pomoc",
      createdAt: daysAgo(0),
      status: "open",
      handledBy: null,
      handledAt: null,
      handledReason: null,
    });

    const { users } = await list(as("boss"));
    expect(
      users.find((row) => row.uid === "brand-new")?.accessRequest?.status,
    ).toBe("open");
  });

  it("names a nominator from Auth when the walk does not have them", async () => {
    nomination("nominee", {
      level: "trusted",
      by: "migration:set_auth_claims",
    });
    nomination("worker", { level: "trusted", by: "gone" });

    const { users } = await list(as("boss"));
    const byUid = new Map(users.map((row) => [row.uid, row]));
    expect(byUid.get("nominee")?.nomination?.desired.byName).toBeNull();
    expect(byUid.get("worker")?.nomination?.desired.byName).toBeNull();
    // A `migration:` author is not an account and is never looked up.
    const looked = fakeAuth.getUsers.mock.calls.flatMap(([ids]) =>
      ids.map((id) => id.uid),
    );
    expect(looked).not.toContain("migration:set_auth_claims");
  });

  it("puts the most recently seen first", async () => {
    const { users } = await list(as("boss"));
    const order = users.map((row) => row.uid);
    // Opened 2 days ago, seen 3 days ago, active 4 days ago, against an account
    // last signed into 20 days ago.
    expect(order.indexOf("newcomer")).toBeLessThan(order.indexOf("visitor"));
    expect(order.indexOf("visitor")).toBeLessThan(order.indexOf("worker"));
    expect(order.indexOf("worker")).toBeLessThan(order.indexOf("boss"));
  });
});

describe("GET /api/admin/users/[uid]", () => {
  beforeEach(() => {
    account("anna", { displayName: "Anna" });
  });

  it("is a 404 for an account that does not exist", async () => {
    await expect(detail(as("boss"), "nobody")).rejects.toMatchObject({
      statusCode: 404,
    });
    // No counting for a key nobody owns.
    expect(reads.filter((read) => read.kind === "count")).toEqual([]);
  });

  it("is a 400 without a uid", async () => {
    await expect(detail(as("boss"), "")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("counts what the account did since it was created, by count()", async () => {
    stored("votes", "v1", { userUid: "anna" });
    stored("votes", "v2", { userUid: "anna" });
    stored("votes", "v3", { userUid: "someone" });
    stored("notes", "n1", { userUid: "anna" });
    stored("revisions", "r1", {
      update_user: "anna",
      update_automatic: false,
      status: "approved",
    });
    stored("revisions", "r2", {
      update_user: "anna",
      update_automatic: false,
      status: "rejected",
    });
    stored("revisions", "r3", {
      update_user: "anna",
      update_automatic: false,
      status: "pending",
    });
    stored("revisions", "r4", { update_user: "anna", update_automatic: false });
    stored("revisions", "r5", {
      update_user: "anna",
      update_automatic: true,
      status: "approved",
    });
    stored("audit", "a1", { user: "anna", at: daysAgo(5) });
    stored("feedback", "f1", { userUid: "anna" });
    stored("qaChecks", "q1", { userUid: "anna" });
    stored("qaChecks", "q2", { userUid: "anna" });
    stored("comments", "c1", { authorId: "anna" });
    stored("images", "i1", { uploadedBy: "anna" });

    const event = as("boss");
    const result = await detail(event, "anna");

    expect(result.lifetime).toEqual({
      votes: 2,
      notes: 1,
      revisions: { total: 4, approved: 1, rejected: 1, pending: 2 },
      decisions: 1,
      feedback: 1,
      qaChecks: 2,
      comments: 1,
      images: 1,
    });
    // Aggregations, never scans of the collections themselves.
    for (const collection of [
      "votes",
      "notes",
      "revisions",
      "audit",
      "feedback",
      "qaChecks",
      "comments",
      "images",
    ]) {
      expect(
        reads.filter(
          (read) => read.collection === collection && read.kind === "get",
        ),
      ).toEqual([]);
    }
    expect(event.sent["Cache-Control"]).toBe("private, no-store");
  });

  it("keeps the lifetime counts for five minutes", async () => {
    await detail(as("boss"), "anna");
    const counted = reads.filter((read) => read.kind === "count").length;
    stored("votes", "v9", { userUid: "anna" });

    const again = await detail(as("boss"), "anna");
    expect(reads.filter((read) => read.kind === "count").length).toBe(counted);
    expect(again.lifetime.votes).toBe(0);
  });

  it("returns the account's row", async () => {
    nomination("anna", { level: "trusted" });
    const { row } = await detail(as("boss"), "anna");
    expect(row).toMatchObject({
      uid: "anna",
      displayName: "Anna",
      nomination: {
        desired: { level: "trusted", byName: "Szefowa" },
        pending: true,
      },
    });
  });

  it("counts a trial since it began", async () => {
    account("trialist", { displayName: "Na próbie", claims: TRIAL });
    const startedAt = iso(now - 10 * DAY - 60 * 60 * 1000);
    nomination(
      "trialist",
      { level: "admin", trial: true },
      { trialStartedAt: startedAt },
    );
    const at = (days: number) => Timestamp.fromMillis(now - days * DAY);
    stored("revisions", "before", {
      update_user: "trialist",
      update_time: at(11),
      update_automatic: false,
    });
    stored("revisions", "during", {
      update_user: "trialist",
      update_time: at(3),
      update_automatic: false,
    });
    stored("revisions", "flagless", {
      update_user: "trialist",
      update_time: at(2),
    });
    stored("revisions", "automatic", {
      update_user: "trialist",
      update_time: at(1),
      update_automatic: true,
    });
    stored("audit", "old", { user: "trialist", at: daysAgo(30) });
    stored("audit", "new", { user: "trialist", at: daysAgo(1) });
    // The script's own clock, in Python's format.
    stored("audit", "python", {
      user: "trialist",
      at: daysAgo(2).replace("Z", "+00:00"),
    });

    const result = await detail(as("boss"), "trialist");
    expect(result.trial).toEqual({
      startedAt,
      days: 10,
      revisions: 2,
      decisions: 2,
    });
  });

  it("has no trial for an account that is not on one", async () => {
    nomination("anna", { level: "trusted" }, { trialStartedAt: daysAgo(3) });
    expect((await detail(as("boss"), "anna")).trial).toBeNull();
  });

  it("has no trial numbers when nobody recorded the start", async () => {
    account("trialist", { claims: TRIAL });
    expect((await detail(as("boss"), "trialist")).trial).toBeNull();
  });

  it("shows the history newest first, with who did it", async () => {
    stored("userActions", "h1", {
      kind: "nominate",
      target: "anna",
      by: "boss",
      at: daysAgo(3),
      reason: "Pomaga",
      from: { level: "normal", trial: false, owner: false },
      to: { level: "trusted", trial: false },
    });
    stored("userActions", "h2", {
      kind: "apply",
      target: "anna",
      by: "script:set_auth_claims@laptop",
      at: daysAgo(1).replace("Z", "+00:00"),
    });
    stored("userActions", "other", {
      kind: "nominate",
      target: "someone-else",
      by: "boss",
      at: daysAgo(1),
    });

    const { history } = await detail(as("boss"), "anna");
    expect(history.map((line) => line.id)).toEqual(["h2", "h1"]);
    expect(history[1]).toEqual({
      id: "h1",
      kind: "nominate",
      target: "anna",
      by: "boss",
      byName: "Szefowa",
      at: daysAgo(3),
      reason: "Pomaga",
      from: { level: "normal", trial: false, owner: false },
      to: { level: "trusted", trial: false },
    });
    expect(history[0]?.byName).toBeNull();
  });

  it("caps the history at 200 lines", async () => {
    for (let i = 0; i < 205; i++) {
      stored("userActions", `h${i}`, {
        kind: "nominate",
        target: "anna",
        by: "boss",
        at: iso(now - i * 1000),
      });
    }
    const { history } = await detail(as("boss"), "anna");
    expect(history).toHaveLength(200);
    expect(history[0]?.id).toBe("h0");
  });

  it("links to the proposals, the activity and a public profile", async () => {
    const result = await detail(as("boss"), "anna");
    expect(result.links).toEqual({
      revisions: "/admin/rewizje?author=anna&status=all&automatic=all#kolejka",
      activity: "/aktywnosc?kto=anna",
      profile: null,
    });

    stored("users", "anna", { publicProfile: true });
    stored("profiles", "anna", {
      handle: "anna-k",
      avatarImageId: null,
      hidden: null,
    });
    expect((await detail(as("boss"), "anna")).links.profile).toBe(
      "/uczestnik/anna-k",
    );

    stored("profiles", "anna", {
      handle: "anna-k",
      avatarImageId: null,
      hidden: { by: "boss", at: daysAgo(0), reason: "Podszywa się" },
    });
    expect((await detail(as("boss"), "anna")).links.profile).toBeNull();
  });
});

describe("POST /api/admin/users/nominate", () => {
  beforeEach(() => {
    account("anna", { displayName: "Anna" });
  });

  it.each([
    ["no reason", { uid: "anna", level: "trusted" }],
    ["a reason too short", { uid: "anna", level: "trusted", reason: " a " }],
    [
      "a level that does not exist",
      { uid: "anna", level: "owner", reason: "Bo tak" },
    ],
    ["no uid", { level: "trusted", reason: "Bo tak" }],
    [
      "a reason past the limit",
      { uid: "anna", level: "trusted", reason: "x".repeat(501) },
    ],
  ])("refuses %s", async (_label, body) => {
    await expect(nominate(as("boss"), body)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(commits).toEqual([]);
  });

  it("refuses to let anybody nominate themselves", async () => {
    await expect(
      nominate(as("boss"), {
        uid: "boss",
        level: "normal",
        reason: "Odchodzę",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(commits).toEqual([]);
  });

  it("is a 404 for an account that does not exist", async () => {
    await expect(
      nominate(as("boss"), {
        uid: "nobody",
        level: "trusted",
        reason: "Bo tak",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(commits).toEqual([]);
  });

  it.each(["pipeline-people-import", "migration:merge-duplicate-people"])(
    "refuses the robot %s",
    async (uid) => {
      account(uid);
      await expect(
        nominate(as("boss"), { uid, level: "trusted", reason: "Bo tak" }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(commits).toEqual([]);
    },
  );

  it.each([
    ["the team", {}, { level: "datascience" }],
    ["admin", {}, { level: "admin" }],
    [
      "admin from the team",
      { trusted: true, datascience: true },
      { level: "admin" },
    ],
    // The same level, a different role: the script refuses anything not below
    // what the account holds, so it is refused here before anybody is asked.
    ["the end of a trial", TRIAL, { level: "admin", trial: false }],
  ])(
    "refuses %s for an address nobody verified",
    async (_label, claims, wish) => {
      account("anna", {
        emailVerified: false,
        providers: ["password"],
        claims,
      });
      await expect(
        nominate(as("boss"), { uid: "anna", ...wish, reason: "Bo tak" }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(commits).toEqual([]);
    },
  );

  it("lets an unverified administrator be stepped down to the team", async () => {
    // An administrator from before addresses were checked: keeping them an
    // administrator because their address is unverified would be the rule
    // working against itself.
    account("anna", {
      emailVerified: false,
      providers: ["password"],
      claims: ADMIN,
    });
    const row = await nominate(as("boss"), {
      uid: "anna",
      level: "datascience",
      reason: "Bez administracji",
    });
    expect(row.nomination).toMatchObject({
      desired: { level: "datascience" },
      pending: true,
    });
  });

  it("lets a pending promotion of an unverified address be set back to its role", async () => {
    // Nothing is granted, so there is nothing to verify the address for - the
    // script, too, never asks about a wish the account already holds.
    account("anna", {
      emailVerified: false,
      providers: ["password"],
      claims: { trusted: true, datascience: true },
    });
    nomination("anna", { level: "admin", by: "colleague" });
    const row = await nominate(as("boss"), {
      uid: "anna",
      level: "datascience",
      reason: "Jednak nie",
    });
    expect(row.nomination?.pending).toBe(false);
  });

  it("lets an unverified address be trusted", async () => {
    account("anna", { emailVerified: false, providers: ["password"] });
    const row = await nominate(as("boss"), {
      uid: "anna",
      level: "trusted",
      reason: "Pomaga",
    });
    expect(row.nomination?.desired.level).toBe("trusted");
  });

  it.each([
    ["below admin", { level: "datascience" }],
    ["onto a trial", { level: "admin", trial: true }],
  ])("refuses to take the owner %s", async (_label, wish) => {
    account("owner", { claims: OWNER });
    await expect(
      nominate(as("boss"), { uid: "owner", ...wish, reason: "Przewrót" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(commits).toEqual([]);
  });

  it("refuses a nomination that changes nothing", async () => {
    await expect(
      nominate(as("boss"), {
        uid: "team",
        level: "datascience",
        reason: "Bez zmian",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(commits).toEqual([]);
  });

  it("writes the wish, a line of history, and answers with the row", async () => {
    const event = as("boss");
    const row = await nominate(event, {
      uid: "anna",
      level: "admin",
      trial: true,
      reason: "  Robi świetną robotę  ",
    });

    expect(doc("roleNominations", "anna")).toEqual({
      desired: {
        level: "admin",
        trial: true,
        reason: "Robi świetną robotę",
        by: "boss",
        at: expect.stringMatching(/Z$/),
      },
      applied: null,
      trialStartedAt: null,
      applyError: null,
    });
    expect(rowsOf("userActions")).toEqual([
      {
        kind: "nominate",
        target: "anna",
        by: "boss",
        at: expect.stringMatching(/Z$/),
        reason: "Robi świetną robotę",
        from: { level: "normal", trial: false, owner: false },
        to: { level: "admin", trial: true },
      },
    ]);
    // One atomic write: the wish never lands without the line that explains
    // it.
    expect(commits).toHaveLength(1);

    expect(row).toMatchObject({
      uid: "anna",
      current: { level: "normal" },
      nomination: {
        desired: { level: "admin", trial: true, by: "boss", byName: "Szefowa" },
        pending: true,
      },
    });
    expect(event.sent["Cache-Control"]).toBe("private, no-store");
  });

  it("keeps what the script wrote when the wish changes", async () => {
    nomination(
      "team",
      { level: "datascience", by: "colleague" },
      {
        applied: {
          level: "datascience",
          trial: false,
          at: daysAgo(9),
          by: "script:set_auth_claims@laptop",
        },
        trialStartedAt: null,
        applyError: { at: daysAgo(2), message: "boom" },
      },
    );

    await nominate(as("boss"), {
      uid: "team",
      level: "admin",
      reason: "Awans",
    });

    expect(doc("roleNominations", "team")).toMatchObject({
      desired: { level: "admin", trial: false, by: "boss" },
      applied: { level: "datascience", at: daysAgo(9) },
      applyError: { message: "boom" },
    });
  });

  it("drops a trial below admin rather than refusing it", async () => {
    await nominate(as("boss"), {
      uid: "anna",
      level: "datascience",
      trial: true,
      reason: "Do importu",
    });
    expect(doc("roleNominations", "anna")).toMatchObject({
      desired: { level: "datascience", trial: false },
    });
  });

  it("ends a trial", async () => {
    const row = await nominate(as("boss"), {
      uid: "trial",
      level: "admin",
      trial: false,
      reason: "Sprawdziła się",
    });
    expect(row.nomination).toMatchObject({
      desired: { level: "admin", trial: false },
      pending: true,
    });
    expect(rowsOf("userActions")[0]).toMatchObject({
      from: { level: "admin", trial: true, owner: false },
      to: { level: "admin", trial: false },
    });
  });

  it("may set the wish back to the live role while something is pending", async () => {
    nomination("anna", { level: "admin", by: "colleague" });
    const row = await nominate(as("boss"), {
      uid: "anna",
      level: "normal",
      reason: "Jednak nie",
    });
    expect(row.nomination?.pending).toBe(false);
  });

  it("lets the owner be nominated to what they are", async () => {
    account("owner", { claims: OWNER });
    nomination("owner", { level: "admin", trial: true, by: "colleague" });
    const row = await nominate(as("boss"), {
      uid: "owner",
      level: "admin",
      reason: "Odkręcam",
    });
    expect(row.nomination?.pending).toBe(false);
  });

  describe("an open request for access", () => {
    beforeEach(() => {
      stored("accessRequests", "anna", {
        reason: "Chcę pomagać przy imporcie",
        source: "pomoc",
        createdAt: daysAgo(2),
        status: "open",
        handledBy: null,
        handledAt: null,
        handledReason: null,
      });
    });

    it.each(["datascience", "admin"])(
      "is answered by a nomination to %s",
      async (level) => {
        const row = await nominate(as("boss"), {
          uid: "anna",
          level,
          reason: "Zapraszamy",
        });
        expect(doc("accessRequests", "anna")).toMatchObject({
          status: "nominated",
          handledBy: "boss",
          handledAt: expect.stringMatching(/Z$/),
          handledReason: "Zapraszamy",
        });
        expect(row.accessRequest?.status).toBe("nominated");
        // Still one write.
        expect(commits).toHaveLength(1);
      },
    );

    it("stays open after a nomination that does not give the tools", async () => {
      await nominate(as("boss"), {
        uid: "anna",
        level: "trusted",
        reason: "Na razie",
      });
      expect(doc("accessRequests", "anna")).toMatchObject({ status: "open" });
    });

    it.each(["datascience", "trusted"])(
      "is left alone once it was dismissed, by a nomination to %s",
      async (level) => {
        stored("accessRequests", "anna", {
          ...(doc("accessRequests", "anna") as Record<string, unknown>),
          status: "dismissed",
          handledBy: "colleague",
        });
        await nominate(as("boss"), {
          uid: "anna",
          level,
          reason: "Jednak tak",
        });
        expect(doc("accessRequests", "anna")).toMatchObject({
          status: "dismissed",
          handledBy: "colleague",
        });
      },
    );
  });

  describe("a request answered by a nomination", () => {
    beforeEach(() => {
      nomination("anna", { level: "datascience", by: "colleague" });
      stored("accessRequests", "anna", {
        reason: "Chcę pomagać przy imporcie",
        source: "pomoc",
        createdAt: daysAgo(3),
        status: "nominated",
        handledBy: "colleague",
        handledAt: daysAgo(1),
        handledReason: "Zapraszamy",
      });
    });

    it.each(["normal", "trusted"])(
      "is open again after a nomination to %s, and the nomination says so",
      async (level) => {
        const row = await nominate(as("boss"), {
          uid: "anna",
          level,
          reason: "Jednak nie",
        });

        // As it was sent: back among the requests, with nothing left of an
        // answer the account will no longer get.
        expect(doc("accessRequests", "anna")).toEqual({
          reason: "Chcę pomagać przy imporcie",
          source: "pomoc",
          createdAt: daysAgo(3),
          status: "open",
          handledBy: null,
          handledAt: null,
          handledReason: null,
        });
        expect(rowsOf("userActions")).toEqual([
          expect.objectContaining({
            kind: "nominate",
            detail: "Prośba o dostęp wróciła do rozpatrzenia.",
          }),
        ]);
        expect(commits).toHaveLength(1);
        expect(row.accessRequest?.status).toBe("open");
      },
    );

    it("stays answered after a nomination to admin", async () => {
      await nominate(as("boss"), {
        uid: "anna",
        level: "admin",
        reason: "Nawet więcej",
      });
      expect(doc("accessRequests", "anna")).toMatchObject({
        status: "nominated",
        handledBy: "colleague",
        handledReason: "Zapraszamy",
      });
      expect(rowsOf("userActions")[0]).not.toHaveProperty("detail");
    });
  });
});

describe("POST /api/admin/users/withdraw", () => {
  beforeEach(() => {
    account("anna", { displayName: "Anna", claims: { trusted: true } });
  });

  it("is a 404 for an account that does not exist", async () => {
    await expect(withdraw(as("boss"), { uid: "nobody" })).rejects.toMatchObject(
      {
        statusCode: 404,
      },
    );
  });

  it("refuses to let anybody withdraw a nomination of themselves", async () => {
    // Keeping your own role against a nomination that takes it away is a
    // nomination of yourself.
    nomination("boss", { level: "normal", by: "colleague" });
    await expect(withdraw(as("boss"), { uid: "boss" })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(commits).toEqual([]);
  });

  it("is a 409 when there is no nomination", async () => {
    await expect(withdraw(as("boss"), { uid: "anna" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(commits).toEqual([]);
  });

  it("is a 409 when nothing is pending", async () => {
    nomination("anna", { level: "trusted" });
    await expect(withdraw(as("boss"), { uid: "anna" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(commits).toEqual([]);
  });

  it("refuses a reason past the limit", async () => {
    nomination("anna", { level: "admin" });
    await expect(
      withdraw(as("boss"), { uid: "anna", reason: "x".repeat(501) }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("sets the wish back to the live role and says what was withdrawn", async () => {
    nomination(
      "anna",
      { level: "admin", trial: true, by: "colleague" },
      {
        applied: {
          level: "trusted",
          trial: false,
          at: daysAgo(9),
          by: "script:x",
        },
      },
    );

    const row = await withdraw(as("boss"), {
      uid: "anna",
      reason: "Za wcześnie",
    });

    expect(doc("roleNominations", "anna")).toMatchObject({
      desired: {
        level: "trusted",
        trial: false,
        by: "boss",
        reason: "Za wcześnie",
      },
      applied: { level: "trusted", at: daysAgo(9) },
    });
    expect(rowsOf("userActions")).toEqual([
      {
        kind: "withdraw",
        target: "anna",
        by: "boss",
        at: expect.stringMatching(/Z$/),
        reason: "Za wcześnie",
        from: { level: "trusted", trial: false, owner: false },
        to: { level: "admin", trial: true },
      },
    ]);
    expect(commits).toHaveLength(1);
    expect(row.nomination).toMatchObject({
      desired: { level: "trusted", byName: "Szefowa" },
      pending: false,
    });
  });

  it("does not need a reason", async () => {
    nomination("anna", { level: "admin" });
    await withdraw(as("boss"), { uid: "anna", reason: "   " });
    expect(doc("roleNominations", "anna")).toMatchObject({
      desired: { level: "trusted", reason: "Wycofanie nominacji" },
    });
    expect(rowsOf("userActions")[0]).not.toHaveProperty("reason");
  });

  describe("a request answered by the nomination", () => {
    beforeEach(() => {
      nomination("anna", { level: "datascience", by: "colleague" });
      stored("accessRequests", "anna", {
        reason: "Chcę pomagać przy imporcie",
        source: "pomoc",
        createdAt: daysAgo(3),
        status: "nominated",
        handledBy: "colleague",
        handledAt: daysAgo(1),
        handledReason: "Zapraszamy",
      });
    });

    it("is open again, and the withdrawal says so", async () => {
      const row = await withdraw(as("boss"), {
        uid: "anna",
        reason: "Za wcześnie",
      });

      expect(doc("accessRequests", "anna")).toEqual({
        reason: "Chcę pomagać przy imporcie",
        source: "pomoc",
        createdAt: daysAgo(3),
        status: "open",
        handledBy: null,
        handledAt: null,
        handledReason: null,
      });
      expect(rowsOf("userActions")).toEqual([
        {
          kind: "withdraw",
          target: "anna",
          by: "boss",
          at: expect.stringMatching(/Z$/),
          reason: "Za wcześnie",
          from: { level: "trusted", trial: false, owner: false },
          to: { level: "datascience", trial: false },
          detail: "Prośba o dostęp wróciła do rozpatrzenia.",
        },
      ]);
      // The wish, the line and the request together, or none of them.
      expect(commits).toHaveLength(1);
      expect(row.accessRequest?.status).toBe("open");
    });

    it("stays answered when the account holds the team's tools already", async () => {
      // The request was granted; what is withdrawn is a step past it.
      account("anna", {
        displayName: "Anna",
        claims: { trusted: true, datascience: true },
      });
      nomination("anna", { level: "admin", by: "colleague" });

      await withdraw(as("boss"), { uid: "anna" });

      expect(doc("accessRequests", "anna")).toMatchObject({
        status: "nominated",
        handledBy: "colleague",
        handledReason: "Zapraszamy",
      });
      expect(rowsOf("userActions")[0]).not.toHaveProperty("detail");
    });

    it.each(["open", "dismissed"])(
      "leaves a request that is %s as it is",
      async (status) => {
        stored("accessRequests", "anna", {
          ...(doc("accessRequests", "anna") as Record<string, unknown>),
          status,
        });
        await withdraw(as("boss"), { uid: "anna" });
        expect(doc("accessRequests", "anna")).toMatchObject({
          status,
          handledBy: "colleague",
        });
        expect(rowsOf("userActions")[0]).not.toHaveProperty("detail");
      },
    );
  });
});

describe("POST /api/admin/users/dismiss-request", () => {
  beforeEach(() => {
    account("anna", { displayName: "Anna" });
    stored("accessRequests", "anna", {
      reason: "Chcę pomagać przy imporcie",
      source: "pomoc",
      createdAt: daysAgo(2),
      status: "open",
      handledBy: null,
      handledAt: null,
      handledReason: null,
    });
  });

  it("is a 404 for an account that does not exist", async () => {
    await expect(dismiss(as("boss"), { uid: "nobody" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("is a 404 when the account asked for nothing", async () => {
    account("quiet");
    await expect(dismiss(as("boss"), { uid: "quiet" })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(commits).toEqual([]);
  });

  it("is a 409 for a request already handled", async () => {
    stored("accessRequests", "anna", {
      ...(doc("accessRequests", "anna") as Record<string, unknown>),
      status: "nominated",
    });
    await expect(dismiss(as("boss"), { uid: "anna" })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(commits).toEqual([]);
  });

  it("refuses a reason past the limit", async () => {
    await expect(
      dismiss(as("boss"), { uid: "anna", reason: "x".repeat(501) }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("dismisses the request with who, when and why", async () => {
    const row = await dismiss(as("boss"), {
      uid: "anna",
      reason: "Najpierw oceny",
    });

    expect(doc("accessRequests", "anna")).toEqual({
      reason: "Chcę pomagać przy imporcie",
      source: "pomoc",
      createdAt: daysAgo(2),
      status: "dismissed",
      handledBy: "boss",
      handledAt: expect.stringMatching(/Z$/),
      handledReason: "Najpierw oceny",
    });
    expect(rowsOf("userActions")).toEqual([
      {
        kind: "dismissRequest",
        target: "anna",
        by: "boss",
        at: expect.stringMatching(/Z$/),
        reason: "Najpierw oceny",
      },
    ]);
    expect(commits).toHaveLength(1);
    expect(row.accessRequest?.status).toBe("dismissed");
  });

  it("does not need a reason", async () => {
    await dismiss(as("boss"), { uid: "anna" });
    expect(doc("accessRequests", "anna")).toMatchObject({
      status: "dismissed",
      handledReason: null,
    });
    expect(rowsOf("userActions")[0]).not.toHaveProperty("reason");
  });
});

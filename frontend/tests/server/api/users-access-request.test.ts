import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import postHandler from "../../../server/api/users/access-request.post";
import getHandler from "../../../server/api/users/access-request.get";
import {
  ACCESS_REQUEST_COOLDOWN_DAYS,
  type AccessRequestDoc,
  type OwnAccessRequest,
  type UserActionDoc,
} from "../../../shared/userAdmin";

const { store, db, mockGetUser, mockAuthGetUser, mockSetResponseHeader } =
  vi.hoisted(() => {
    // Nitro auto-imports createError in server handlers; stub it for tests.
    (globalThis as Record<string, unknown>).createError = (opts: {
      statusCode: number;
      message?: string;
    }) => Object.assign(new Error(opts.message), opts);

    return {
      /** Every document the routes can see, by path. */
      store: new Map<string, Record<string, unknown>>(),
      /** The handle the routes were given, so a test can see how they wrote. */
      db: { current: null as null | { runTransaction: unknown } },
      mockGetUser: vi.fn(),
      mockAuthGetUser: vi.fn(),
      mockSetResponseHeader: vi.fn(),
    };
  });

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
    setResponseHeader: mockSetResponseHeader,
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: mockAuthGetUser }),
}));

/** The part of Firestore the routes use, over `store`: a document read, and a
 * transaction that reads and sets. Writes land when the transaction function
 * returns, and not at all when it throws - as they do. */
function fakeDb() {
  let autoId = 0;
  const snapshot = (path: string) => {
    const data = store.get(path);
    return { exists: data !== undefined, data: () => data };
  };
  const ref = (collection: string, id: string) => {
    const path = `${collection}/${id}`;
    return { id, path, get: async () => snapshot(path) };
  };
  return {
    collection: (name: string) => ({
      doc: (id?: string) => ref(name, id ?? `auto-${++autoId}`),
    }),
    runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const writes: [string, Record<string, unknown>][] = [];
      const result = await fn({
        get: async (target: { path: string }) => snapshot(target.path),
        set: (target: { path: string }, data: Record<string, unknown>) =>
          writes.push([target.path, data]),
      });
      for (const [path, data] of writes) store.set(path, data);
      return result;
    }),
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: (database: string) => {
    // Everything this feature stores lives in the named database; `(default)`
    // is one nothing else reads.
    expect(database).toBe("koryta-pl");
    return db.current;
  },
}));

const NOW = "2026-10-05T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(Date.parse(NOW) - days * DAY).toISOString();

const post = (body: unknown) =>
  (postHandler as unknown as (event: unknown) => Promise<OwnAccessRequest>)({
    body,
  });
const get = () =>
  (getHandler as unknown as (event: unknown) => Promise<OwnAccessRequest>)({});

const REASON = "Zbieram artykuły o spółkach komunalnych z mojego powiatu.";

function storedRequest(fields: Partial<AccessRequestDoc> = {}) {
  const doc: AccessRequestDoc = {
    reason: "Chcę pomagać przy artykułach.",
    source: "pomoc",
    createdAt: daysAgo(20),
    status: "open",
    handledBy: null,
    handledAt: null,
    handledReason: null,
    ...fields,
  };
  store.set("accessRequests/user-1", doc);
}

const actions = () =>
  [...store]
    .filter(([path]) => path.startsWith("userActions/"))
    .map(([, doc]) => doc as UserActionDoc);

const signedInAs = (token: Record<string, unknown>) =>
  mockGetUser.mockResolvedValue({ uid: "user-1", ...token });

/** The account as the auth service has it now. */
const liveClaims = (claims: Record<string, unknown> | undefined) =>
  mockAuthGetUser.mockResolvedValue({ uid: "user-1", customClaims: claims });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  store.clear();
  db.current = fakeDb();
  signedInAs({});
  liveClaims(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/users/access-request", () => {
  describe("who may ask", () => {
    it("passes an authentication failure through untouched", async () => {
      mockGetUser.mockRejectedValue(
        Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
      );

      await expect(
        post({ reason: REASON, source: "pomoc" }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(store.size).toBe(0);
    });

    it.each(["pipeline-scraper", "migration:merge-duplicate-people"])(
      "refuses the robot account %s",
      async (uid) => {
        mockGetUser.mockResolvedValue({ uid });

        await expect(
          post({ reason: REASON, source: "pomoc" }),
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(mockAuthGetUser).not.toHaveBeenCalled();
        expect(store.size).toBe(0);
      },
    );

    it("tells somebody whose token already opens the tools so", async () => {
      signedInAs({ datascience: true });

      await expect(
        post({ reason: REASON, source: "rozszerzenie" }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: "Masz już dostęp do narzędzi zespołu.",
      });
      expect(store.size).toBe(0);
    });

    it("reads the account, not only the token, before taking a request", async () => {
      // Granted by the script a minute ago: the token in this browser is the
      // old one for up to an hour, and a request filed in that hour would land
      // in the administrators' queue for somebody who no longer needs it.
      liveClaims({ trusted: true, datascience: true });

      await expect(
        post({ reason: REASON, source: "rozszerzenie" }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message: "Masz już dostęp do narzędzi zespołu.",
      });
      expect(mockAuthGetUser).toHaveBeenCalledWith("user-1");
      expect(store.size).toBe(0);
    });

    it("refuses an account that is gone", async () => {
      mockAuthGetUser.mockRejectedValue(
        Object.assign(new Error("gone"), { code: "auth/user-not-found" }),
      );

      await expect(
        post({ reason: REASON, source: "pomoc" }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(store.size).toBe(0);
    });
  });

  describe("what it takes", () => {
    it.each([
      [
        "a reason under ten characters",
        { reason: "za krótko", source: "pomoc" },
      ],
      [
        "a reason that is short once trimmed",
        { reason: "   krótko       ", source: "pomoc" },
      ],
      [
        "a reason over a thousand characters",
        { reason: "a".repeat(1001), source: "pomoc" },
      ],
      ["no reason", { source: "pomoc" }],
      ["a page that has no button", { reason: REASON, source: "admin" }],
      ["no page", { reason: REASON }],
    ])("rejects %s", async (_label, body) => {
      await expect(post(body)).rejects.toThrow();
      expect(store.size).toBe(0);
    });
  });

  describe("one standing request", () => {
    it("refuses a second request while the first waits", async () => {
      storedRequest({ status: "open", createdAt: daysAgo(1) });

      await expect(
        post({ reason: REASON, source: "pomoc" }),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(actions()).toEqual([]);
    });

    it.each(["dismissed", "nominated"] as const)(
      "asks for patience after a %s request, and says until when",
      async (status) => {
        storedRequest({
          status,
          createdAt: daysAgo(10),
          handledBy: "admin-1",
          handledAt: daysAgo(2),
          handledReason: "Najpierw porozmawiajmy na Slacku.",
        });

        await expect(
          post({ reason: REASON, source: "pomoc" }),
        ).rejects.toMatchObject({
          statusCode: 429,
          data: { retryAfter: daysAgo(2 - ACCESS_REQUEST_COOLDOWN_DAYS) },
        });
        expect(store.get("accessRequests/user-1")?.status).toBe(status);
        expect(actions()).toEqual([]);
      },
    );

    it("counts the wait from the request when nobody stamped the answer", async () => {
      storedRequest({ status: "dismissed", createdAt: daysAgo(3) });

      await expect(
        post({ reason: REASON, source: "pomoc" }),
      ).rejects.toMatchObject({
        statusCode: 429,
        data: { retryAfter: daysAgo(3 - ACCESS_REQUEST_COOLDOWN_DAYS) },
      });
    });

    it("takes a fresh request once the wait is over", async () => {
      storedRequest({
        status: "dismissed",
        createdAt: daysAgo(30),
        handledBy: "admin-1",
        handledAt: daysAgo(8),
        handledReason: "Za wcześnie.",
      });

      await post({ reason: REASON, source: "rozszerzenie" });

      // The earlier answer is not carried into the new request: the history
      // keeps it, and the queue asks a fresh question.
      expect(store.get("accessRequests/user-1")).toEqual({
        reason: REASON,
        source: "rozszerzenie",
        createdAt: NOW,
        status: "open",
        handledBy: null,
        handledAt: null,
        handledReason: null,
      });
    });
  });

  describe("a request that goes through", () => {
    it("stores it as open, with the line that says who asked", async () => {
      const answer = await post({ reason: `  ${REASON}  `, source: "pomoc" });

      expect(store.get("accessRequests/user-1")).toEqual({
        reason: REASON,
        source: "pomoc",
        createdAt: NOW,
        status: "open",
        handledBy: null,
        handledAt: null,
        handledReason: null,
      });
      expect(actions()).toEqual([
        {
          kind: "accessRequest",
          target: "user-1",
          by: "user-1",
          at: NOW,
          reason: REASON,
          detail: "/pomoc",
        },
      ]);
      expect(answer).toEqual({
        request: { status: "open", createdAt: NOW, source: "pomoc" },
        canRequest: false,
        retryAfter: null,
        hasAccess: false,
      });
    });

    it("writes the request and its log line in one transaction", async () => {
      await post({ reason: REASON, source: "pomoc" });

      // A transaction rather than a bare batch: the read that found no open
      // request is the one the write is conditional on, so a double click
      // files one request and one line rather than two.
      expect(db.current?.runTransaction).toHaveBeenCalledTimes(1);
      expect([...store.keys()].sort()).toEqual([
        "accessRequests/user-1",
        "userActions/auto-1",
      ]);
    });

    it("is never cached on the way back", async () => {
      await post({ reason: REASON, source: "pomoc" });

      expect(mockSetResponseHeader).toHaveBeenCalledWith(
        expect.anything(),
        "Cache-Control",
        "private, no-store",
      );
    });
  });
});

describe("GET /api/users/access-request", () => {
  it("passes an authentication failure through untouched", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("brak tokenu"), { statusCode: 401 }),
    );

    await expect(get()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("offers the form to somebody who never asked", async () => {
    await expect(get()).resolves.toEqual({
      request: null,
      canRequest: true,
      retryAfter: null,
      hasAccess: false,
    });
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      "Cache-Control",
      "private, no-store",
    );
  });

  it("says a request is waiting, and nothing more", async () => {
    storedRequest({ status: "open", createdAt: daysAgo(1) });

    await expect(get()).resolves.toEqual({
      request: { status: "open", createdAt: daysAgo(1), source: "pomoc" },
      canRequest: false,
      retryAfter: null,
      hasAccess: false,
    });
  });

  it("gives the date a dismissed request may be renewed, but not who dismissed it or why", async () => {
    storedRequest({
      status: "dismissed",
      createdAt: daysAgo(10),
      handledBy: "admin-1",
      handledAt: daysAgo(2),
      handledReason: "Nie znamy tej osoby.",
    });

    const answer = await get();

    expect(answer).toEqual({
      request: { status: "dismissed", createdAt: daysAgo(10), source: "pomoc" },
      canRequest: false,
      retryAfter: daysAgo(2 - ACCESS_REQUEST_COOLDOWN_DAYS),
      hasAccess: false,
    });
    expect(JSON.stringify(answer)).not.toContain("admin-1");
    expect(JSON.stringify(answer)).not.toContain("Nie znamy");
  });

  it("opens the form again the moment the wait is over", async () => {
    storedRequest({
      status: "dismissed",
      createdAt: daysAgo(30),
      handledAt: daysAgo(ACCESS_REQUEST_COOLDOWN_DAYS),
    });

    await expect(get()).resolves.toMatchObject({
      canRequest: true,
      retryAfter: null,
    });
  });

  it("knows the tools are already open from the token, without asking the account", async () => {
    signedInAs({ datascience: true });

    await expect(get()).resolves.toEqual({
      request: null,
      canRequest: false,
      retryAfter: null,
      hasAccess: true,
    });
    expect(mockAuthGetUser).not.toHaveBeenCalled();
  });

  it("knows the tools are open before the token does", async () => {
    storedRequest({
      status: "nominated",
      handledBy: "admin-1",
      handledAt: daysAgo(1),
    });
    liveClaims({ trusted: true, datascience: true });

    await expect(get()).resolves.toMatchObject({
      request: { status: "nominated" },
      canRequest: false,
      hasAccess: true,
    });
  });
});

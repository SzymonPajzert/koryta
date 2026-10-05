import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../../server/api/users/seen.post";
import {
  RECENT_AUTH_TIMES,
  type UserStatsDoc,
} from "../../../shared/userAdmin";

const { mockVerifyIdToken, stored, mockRunTransaction } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  return {
    mockVerifyIdToken: vi.fn(),
    /** `userStats` as the transaction sees it, by document path. */
    stored: new Map<string, unknown>(),
    mockRunTransaction: vi.fn(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return { ...actual, defineEventHandler: (fn: unknown) => fn };
});

// The real `getUser`, so the 401s below are the ones a browser would get; only
// the token check behind it is faked.
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

// A one-document store the transaction reads and writes, so a test can send
// several pings in a row and look at what they added up to.
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      mockRunTransaction();
      return fn({
        get: async (ref: { path: string }) => ({
          exists: stored.has(ref.path),
          data: () => stored.get(ref.path),
        }),
        set: (ref: { path: string }, data: unknown) => {
          stored.set(ref.path, data);
        },
      });
    },
  }),
}));

type Event = { headers?: Record<string, string> };
const call = (event: Event = { headers: { authorization: "Bearer good" } }) =>
  (handler as unknown as (e: Event) => Promise<unknown>)(event);

/** 2026-10-05 09:00 UTC, as an `auth_time`. */
const MORNING = Date.UTC(2026, 9, 5, 9) / 1000;

/** A ping from a browser holding a token of this sign-in. */
const ping = async (authTime: number, provider = "google.com", uid = "u1") => {
  mockVerifyIdToken.mockResolvedValueOnce({
    uid,
    auth_time: authTime,
    firebase: { sign_in_provider: provider },
  });
  return call();
};

const stats = (uid = "u1") => stored.get(`userStats/${uid}`) as UserStatsDoc;

describe("POST /api/users/seen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("refuses a caller with no token", async () => {
    await expect(call({ headers: {} })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("refuses a token that does not verify", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("expired"));

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("records nothing on autopush, which writes to the production database", async () => {
    vi.stubEnv("K_SERVICE", "autopush");

    // null is what h3 sends as a 204.
    expect(await ping(MORNING)).toBeNull();
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it("records on prod", async () => {
    vi.stubEnv("K_SERVICE", "prod");

    expect(await ping(MORNING)).toBeNull();
    expect(stats().signIns).toBe(1);
  });

  it.each([["pipeline"], ["pipeline-pagerank"], ["migration:seed"]])(
    "records nothing for the robot %s",
    async (uid) => {
      expect(await ping(MORNING, "custom", uid)).toBeNull();
      expect(mockRunTransaction).not.toHaveBeenCalled();
    },
  );

  it("starts the record on the first ping", async () => {
    expect(await ping(MORNING)).toBeNull();

    // Exactly these fields: no page, no address, no browser.
    expect(stats()).toEqual({
      firstSeenAt: "2026-10-05T10:00:00.000Z",
      lastSeenAt: "2026-10-05T10:00:00.000Z",
      lastActiveDay: "2026-10-05",
      activeDays: 1,
      signIns: 1,
      recentAuthTimes: [MORNING],
      lastProvider: "google.com",
    } satisfies UserStatsDoc);
  });

  it("counts the same session on the same day once", async () => {
    await ping(MORNING);
    vi.setSystemTime(new Date("2026-10-05T21:30:00.000Z"));
    await ping(MORNING);

    expect(stats()).toMatchObject({
      firstSeenAt: "2026-10-05T10:00:00.000Z",
      lastSeenAt: "2026-10-05T21:30:00.000Z",
      activeDays: 1,
      signIns: 1,
      recentAuthTimes: [MORNING],
    });
  });

  it("counts a new UTC day as an active day, not a sign-in", async () => {
    await ping(MORNING);
    // Days are UTC: ten past midnight is the next one.
    vi.setSystemTime(new Date("2026-10-06T00:10:00.000Z"));
    await ping(MORNING);

    expect(stats()).toMatchObject({
      firstSeenAt: "2026-10-05T10:00:00.000Z",
      lastSeenAt: "2026-10-06T00:10:00.000Z",
      lastActiveDay: "2026-10-06",
      activeDays: 2,
      signIns: 1,
    });
  });

  it("counts a new auth_time as a sign-in and keeps its provider", async () => {
    await ping(MORNING, "google.com");
    await ping(MORNING + 3600, "password");

    expect(stats()).toMatchObject({
      activeDays: 1,
      signIns: 2,
      recentAuthTimes: [MORNING + 3600, MORNING],
      lastProvider: "password",
    });
  });

  it("does not count a sign-in it has seen again", async () => {
    // Two browsers, signed in an hour apart, each pinging once.
    await ping(MORNING, "google.com");
    await ping(MORNING + 3600, "password");
    // The first one again, the next day.
    vi.setSystemTime(new Date("2026-10-06T08:00:00.000Z"));
    await ping(MORNING, "google.com");

    expect(stats()).toMatchObject({
      activeDays: 2,
      signIns: 2,
      recentAuthTimes: [MORNING + 3600, MORNING],
      // Still the newest sign-in's: an older session pinging later is not
      // the way the account last signed in.
      lastProvider: "password",
    });
  });

  it(`keeps only the newest ${RECENT_AUTH_TIMES} sign-ins`, async () => {
    for (let i = 0; i < RECENT_AUTH_TIMES + 5; i++) {
      await ping(MORNING + i * 60);
    }

    const { signIns, recentAuthTimes } = stats();
    expect(signIns).toBe(RECENT_AUTH_TIMES + 5);
    expect(recentAuthTimes).toHaveLength(RECENT_AUTH_TIMES);
    expect(recentAuthTimes[0]).toBe(MORNING + (RECENT_AUTH_TIMES + 4) * 60);
    expect(recentAuthTimes.at(-1)).toBe(MORNING + 5 * 60);
  });

  it("does not count again a session older than every one it kept", async () => {
    for (let i = 0; i < RECENT_AUTH_TIMES + 5; i++) {
      await ping(MORNING + i * 60);
    }
    // The very first browser, still signed in, pings on another day. Its
    // auth_time dropped out of the list, but it cannot be a new sign-in: a
    // sign-in made now would carry a time newer than all of them.
    vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z"));
    await ping(MORNING);

    expect(stats()).toMatchObject({
      signIns: RECENT_AUTH_TIMES + 5,
      activeDays: 2,
    });
    expect(stats().recentAuthTimes).not.toContain(MORNING);
  });

  it("still counts the day when the token carries no auth_time", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      uid: "u1",
      firebase: { sign_in_provider: "google.com" },
    });
    await call();

    expect(stats()).toMatchObject({
      activeDays: 1,
      signIns: 0,
      recentAuthTimes: [],
      lastProvider: "google.com",
    });
  });

  it("keeps each account's record apart", async () => {
    await ping(MORNING, "google.com", "u1");
    await ping(MORNING, "password", "u2");

    expect(stats("u1").lastProvider).toBe("google.com");
    expect(stats("u2")).toMatchObject({ signIns: 1, lastProvider: "password" });
  });
});

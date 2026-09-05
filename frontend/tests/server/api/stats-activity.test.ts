import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityStats } from "../../../server/api/stats/activity.get";
import { activityRanges } from "../../../shared/activity";
import handler from "../../../server/api/stats/activity.get";

const {
  mockGetUser,
  mockGetUsers,
  mockCollect,
  mockEnsure,
  userDocs,
  headers,
} = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  // Nitro wraps the read-and-roll-up in its cache; here it runs straight
  // through, so each test sees the events it set up.
  globals.defineCachedFunction = (fn: unknown) => fn;

  return {
    mockGetUser: vi.fn(),
    mockGetUsers: vi.fn(),
    mockCollect: vi.fn(),
    mockEnsure: vi.fn(),
    userDocs: new Map<string, Record<string, unknown>>(),
    headers: new Map<string, string>(),
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
    ) => parser(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers }),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({ collection: name, id }),
    }),
    // The real `getAll` takes a trailing `ReadOptions`, which the handler uses
    // to mask everything but `publicProfile`; drop it rather than treating it
    // as another document reference.
    getAll: async (...args: { collection?: string; id?: string }[]) =>
      args
        .filter((arg): arg is { collection: string; id: string } => !!arg.id)
        .map((ref) => ({
          id: ref.id,
          data: () => userDocs.get(ref.id),
        })),
  }),
}));

vi.mock("~~/server/utils/auth", () => ({ getOptionalUser: mockGetUser }));

vi.mock("~~/server/utils/activityEvents", () => ({
  collectActivityEvents: mockCollect,
}));

// Finished days come from the stored rollups; this suite is about how the
// endpoint presents them, so it puts every event on today and leaves the store
// empty. `activityRollup.test.ts` covers the storing.
vi.mock("~~/server/utils/activityRollup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~~/server/utils/activityRollup")>();
  return { ...actual, ensureDailyRollups: mockEnsure };
});

const call = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<ActivityStats>)({ query });

/** Now, so the events land inside whatever window the handler computes. */
const today = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  headers.clear();
  userDocs.clear();
  mockEnsure.mockResolvedValue([]);
  mockCollect.mockResolvedValue({
    events: [
      { uid: "busy", kind: "vote", at: today },
      { uid: "busy", kind: "vote", at: today },
      { uid: "busy", kind: "revision", at: today },
      { uid: "quiet", kind: "vote", at: today },
    ],
    truncated: [],
  });
  mockGetUsers.mockResolvedValue({
    users: [
      {
        uid: "busy",
        displayName: "Anna Nowak",
        email: "anna@example.com",
        photoURL: "https://example.com/anna.png",
      },
      {
        uid: "quiet",
        displayName: "Bartosz Lis",
        email: "bartosz@example.com",
        photoURL: null,
      },
    ],
    notFound: [],
  });
});

describe("/api/stats/activity", () => {
  it("gives an anonymous caller the ranking with every name masked", async () => {
    mockGetUser.mockResolvedValue(null);

    const result = await call();

    expect(result.identified).toBe(false);
    expect(result.contributorCount).toBe(2);
    expect(result.contributors.map((c) => c.name)).toEqual([
      "A•••••",
      "B•••••",
    ]);
    expect(result.namedCount).toBe(0);
    expect(result.self).toBeNull();
    expect(result.totals.vote).toBe(3);
    expect(result.total).toBe(4);
  });

  it("sends a stranger no uid, address, avatar or real name", async () => {
    mockGetUser.mockResolvedValue(null);

    const result = await call();

    expect(result.contributors.every((c) => c.uid === null)).toBe(true);
    expect(result.contributors.every((c) => c.email === null)).toBe(true);
    expect(result.contributors.every((c) => c.photoURL === null)).toBe(true);

    // The whole body, not just the fields checked above - a leak that arrives
    // under some other key is still a leak.
    const body = JSON.stringify(result);
    for (const secret of [
      "busy",
      "quiet",
      "Anna Nowak",
      "anna@example.com",
      "Bartosz Lis",
      "anna.png",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  it("names the contributors who asked to be named", async () => {
    mockGetUser.mockResolvedValue(null);
    userDocs.set("busy", { publicProfile: true });

    const result = await call();

    expect(result.contributors[0]).toMatchObject({
      name: "Anna Nowak",
      named: true,
      uid: null,
      email: null,
      photoURL: "https://example.com/anna.png",
    });
    expect(result.contributors[1]).toMatchObject({
      name: "B•••••",
      named: false,
    });
    expect(result.namedCount).toBe(1);
  });

  it("still withholds a name that was never turned on", async () => {
    mockGetUser.mockResolvedValue(null);
    userDocs.set("busy", { publicProfile: false });
    userDocs.set("quiet", { newsletter: { recentPeople: true } });

    const result = await call();

    expect(result.contributors.map((c) => c.named)).toEqual([false, false]);
  });

  it("shows a signed-in reader their own row and where they stand", async () => {
    mockGetUser.mockResolvedValue({ uid: "quiet" });

    const result = await call();

    // Their own name is not a disclosure to them, whatever the setting says.
    expect(result.contributors[1]).toMatchObject({
      name: "Bartosz Lis",
      named: true,
      isSelf: true,
    });
    // ...and it stays hidden from everyone else on the same page.
    expect(result.contributors[0]).toMatchObject({
      name: "A•••••",
      isSelf: false,
    });
    expect(result.self).toEqual({
      rank: 2,
      total: 1,
      counts: expect.objectContaining({ vote: 1 }),
    });
  });

  it("still hands a signed-in non-admin no uids", async () => {
    mockGetUser.mockResolvedValue({ uid: "quiet" });

    const result = await call();

    expect(result.contributors.every((c) => c.uid === null)).toBe(true);
    expect(result.identified).toBe(false);
  });

  it("places a reader who did nothing nowhere", async () => {
    mockGetUser.mockResolvedValue({ uid: "newcomer" });

    expect((await call()).self).toBeNull();
  });

  it("ranks, names and identifies every contributor for an admin", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });

    const result = await call();

    expect(result.identified).toBe(true);
    expect(result.contributors.map((c) => c.uid)).toEqual(["busy", "quiet"]);
    expect(result.contributors[0]).toMatchObject({
      name: "Anna Nowak",
      email: "anna@example.com",
      total: 3,
      counts: expect.objectContaining({ vote: 2, revision: 1 }),
    });
  });

  it("keeps a uid the auth service has forgotten in the ranking", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockGetUsers.mockResolvedValue({ users: [], notFound: [{ uid: "busy" }] });

    const result = await call();

    // The work happened even if the account is gone.
    expect(result.contributors[0]).toMatchObject({ uid: "busy", total: 3 });
    expect(result.contributors[0]!.name).toBe("Uczestnik #1");
  });

  it("marks a signed-in caller's response uncacheable, since it names them", async () => {
    mockGetUser.mockResolvedValue({ uid: "quiet" });

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("leaves an anonymous response cacheable", async () => {
    mockGetUser.mockResolvedValue(null);

    await call();

    expect(headers.has("Cache-Control")).toBe(false);
  });

  it("defaults to 30 days and honours an explicit range", async () => {
    mockGetUser.mockResolvedValue(null);

    expect((await call()).window.days).toBe(30);
    expect((await call({ days: "7" })).window.days).toBe(7);
    expect((await call({ days: "7" })).daily).toHaveLength(7);
  });

  it("stores the settled days and reads the tail of the window live", async () => {
    mockGetUser.mockResolvedValue(null);

    const result = await call({ days: "7" });
    const settled = mockEnsure.mock.calls[0]![1] as string[];
    const liveSince = mockCollect.mock.calls[0]![1].sinceIso as string;
    const spanned = result.daily.map((day) => day.date);

    // How many days are settled depends on the hour this runs at - yesterday
    // joins them six hours after it ends - so the invariant is asserted rather
    // than the count: the stored days are a prefix of the window, the live scan
    // starts exactly where they stop, and today is never stored.
    expect(settled.length).toBeGreaterThanOrEqual(spanned.length - 2);
    expect(settled.length).toBeLessThanOrEqual(spanned.length - 1);
    expect(settled).toEqual(spanned.slice(0, settled.length));
    expect(liveSince.slice(0, 10)).toBe(spanned[settled.length]);
    // The live scan has no upper bound: today has not finished.
    expect(mockCollect.mock.calls[0]![1].untilIso).toBeUndefined();
  });

  it("answers only for the ranges the page offers", async () => {
    mockGetUser.mockResolvedValue(null);

    for (const days of activityRanges) {
      expect((await call({ days: String(days) })).window.days).toBe(days);
    }
  });

  it("refuses any other range", async () => {
    // Every distinct value is its own memo entry and its own catch-up build, so
    // an open range would let a signed-out caller walk ?days=1..365 and mint a
    // year of independent cold computations.
    mockGetUser.mockResolvedValue(null);

    for (const days of ["0", "1", "45", "365", "3650", "nie"]) {
      await expect(call({ days })).rejects.toThrow();
    }
  });

  it("passes on which kinds were cut short by their scan cap", async () => {
    mockGetUser.mockResolvedValue(null);
    mockCollect.mockResolvedValue({
      events: [],
      truncated: ["vote", "vote", "revision"],
    });

    expect((await call()).truncated.sort()).toEqual(["revision", "vote"]);
  });
});

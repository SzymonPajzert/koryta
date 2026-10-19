import { describe, it, expect, vi, beforeEach } from "vitest";
import logHandler from "../../../server/api/search/log.post";
import summaryHandler from "../../../server/api/admin/searches.get";

const { Timestamp, added, stored, databases, wheres, owner } = vi.hoisted(
  () => {
    (globalThis as Record<string, unknown>).createError = (opts: {
      statusCode: number;
      message?: string;
    }) => Object.assign(new Error(opts.message), opts);
    /** Enough of Firestore's Timestamp for the routes to tell one apart. */
    class Timestamp {
      constructor(readonly millis: number) {}
      static fromMillis(millis: number) {
        return new Timestamp(millis);
      }
      toDate() {
        return new Date(this.millis);
      }
    }
    return {
      Timestamp,
      /** What the log route wrote. */
      added: [] as Record<string, unknown>[],
      /** What the summary route reads back. */
      stored: [] as Record<string, unknown>[],
      /** Which database each route asked for. */
      databases: [] as string[],
      wheres: [] as unknown[][],
      owner: { yes: true },
    };
  },
);

vi.mock("firebase-admin/firestore", () => ({
  Timestamp,
  getFirestore: (database: string) => {
    databases.push(database);
    const query = {
      where: (...args: unknown[]) => {
        wheres.push(args);
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      get: async () => ({
        size: stored.length,
        docs: stored.map((data, i) => ({ id: `s${i}`, data: () => data })),
      }),
    };
    return {
      collection: () => ({
        ...query,
        add: async (doc: Record<string, unknown>) => {
          added.push(doc);
        },
      }),
    };
  },
}));

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (fn: unknown) => fn,
  readBody: async (event: { body: unknown }) => event.body,
  getQuery: (event: { query?: unknown }) => event.query ?? {},
  setResponseHeader: () => {},
}));

vi.mock("../../../server/utils/auth", () => ({
  getOptionalUser: async (event: { headers?: Record<string, string> }) =>
    event.headers?.authorization
      ? { uid: "reader-uid", email: "a@b.pl" }
      : null,
  requireOwner: async () => {
    if (!owner.yes) {
      throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    }
    return { uid: "owner" };
  },
}));

const log = (body: unknown, headers: Record<string, string> = {}) =>
  (logHandler as unknown as (event: unknown) => Promise<unknown>)({
    body,
    headers,
  });

const ENTRY = {
  query: "  Jan   KOWALSKI ",
  results: 2,
  unverified: 2,
  outcome: "pick",
  picked: "person",
  pickedUnverified: true,
};

describe("POST /api/search/log", () => {
  beforeEach(() => {
    added.length = 0;
    databases.length = 0;
  });

  it("keeps the search, normalised, in the ops database", async () => {
    expect(await log(ENTRY)).toEqual({ recorded: true });

    expect(databases).toEqual(["agent-tasks"]);
    expect(added).toHaveLength(1);
    const [doc] = added;
    expect(doc).toMatchObject({
      query: "jan kowalski",
      results: 2,
      unverified: 2,
      outcome: "pick",
      picked: "person",
      pickedUnverified: true,
      signedIn: false,
    });
    // Kept for 180 days, then the TTL policy takes it.
    const at = (doc!.at as InstanceType<typeof Timestamp>).millis;
    const expireAt = (doc!.expireAt as InstanceType<typeof Timestamp>).millis;
    expect(expireAt - at).toBe(180 * 24 * 60 * 60 * 1000);
  });

  it("notes that somebody was signed in, and nothing else about them", async () => {
    await log(ENTRY, { authorization: "Bearer token" });

    const [doc] = added;
    expect(doc!.signedIn).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/reader-uid|a@b\.pl/);
  });

  it("never stores more unpublished hits than there were hits", async () => {
    await log({ ...ENTRY, results: 1, unverified: 9 });
    expect(added[0]!.unverified).toBe(1);
  });

  it("keeps what was opened only for a search that opened something", async () => {
    await log({ ...ENTRY, outcome: "abandon" });
    expect(added[0]).not.toHaveProperty("picked");
    expect(added[0]).not.toHaveProperty("pickedUnverified");
  });

  it("skips a query too short to be a search", async () => {
    expect(await log({ ...ENTRY, query: " ko " })).toEqual({
      recorded: false,
    });
    expect(added).toHaveLength(0);
  });

  it("refuses what the search box would never send", async () => {
    for (const body of [
      { ...ENTRY, outcome: "hover" },
      { ...ENTRY, picked: "Jan Kowalski" },
      { ...ENTRY, results: -1 },
      { ...ENTRY, query: "x".repeat(500) },
      null,
    ]) {
      await expect(log(body)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(added).toHaveLength(0);
  });
});

describe("GET /api/admin/searches", () => {
  const summary = (query: Record<string, string> = {}) =>
    (summaryHandler as unknown as (event: unknown) => Promise<unknown>)({
      query,
    });

  beforeEach(() => {
    owner.yes = true;
    stored.length = 0;
    wheres.length = 0;
  });

  it("is the owner's alone", async () => {
    owner.yes = false;
    await expect(summary()).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reads the window asked for and puts each query on one row", async () => {
    stored.push(
      {
        query: "jan kowalski",
        results: 0,
        unverified: 0,
        outcome: "abandon",
        signedIn: false,
        at: Timestamp.fromMillis(Date.parse("2026-10-13T10:00:00Z")),
      },
      {
        query: "jan kowalski",
        results: 2,
        unverified: 2,
        outcome: "pick",
        picked: "person",
        pickedUnverified: true,
        signedIn: true,
        at: Timestamp.fromMillis(Date.parse("2026-10-14T10:00:00Z")),
      },
    );

    const answer = (await summary({ days: "7" })) as Record<string, unknown>;

    // Seven days back from when it ran, give or take the test's own time.
    const since = (wheres[0]![2] as InstanceType<typeof Timestamp>).millis;
    expect(wheres[0]!.slice(0, 2)).toEqual(["at", ">="]);
    expect(Math.abs(Date.now() - since - 7 * 24 * 60 * 60 * 1000)).toBeLessThan(
      1000,
    );
    expect(answer).toEqual({
      days: 7,
      total: 2,
      signedOut: 1,
      truncated: false,
      queries: [
        {
          query: "jan kowalski",
          count: 2,
          signedOut: 1,
          noResults: 1,
          onlyUnverified: 1,
          picks: 1,
          proposes: 0,
          lastAt: "2026-10-14T10:00:00.000Z",
        },
      ],
    });
  });

  it("will not read past what is kept", async () => {
    await expect(summary({ days: "365" })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

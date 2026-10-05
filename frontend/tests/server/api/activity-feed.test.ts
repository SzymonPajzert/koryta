import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  ActivityFeed,
  RawFeed,
  RawFeedBatch,
} from "../../../shared/activityFeed";
import { feedRanges } from "../../../shared/activityFeed";
import handler from "../../../server/api/activity/feed.get";

const {
  mockGetUser,
  mockAuthGetUser,
  mockGetUsers,
  mockListUsers,
  mockBuild,
  userDocs,
  headers,
  memo,
  computed,
} = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);

  const memo = new Map<string, unknown>();
  const computed = new Map<string, unknown>();
  // Unlike the pass-through stub the stats suite uses, this one memoizes by
  // key the way nitro does: every caller of a window gets the one object. That
  // is what lets a test catch a presentation that writes into it. `computed`
  // keeps a copy of each value as it was built.
  globals.defineCachedFunction =
    (
      fn: (...args: unknown[]) => Promise<unknown>,
      opts: { getKey: (...args: unknown[]) => string },
    ) =>
    async (...args: unknown[]) => {
      const key = opts.getKey(...args);
      if (!memo.has(key)) {
        const value = await fn(...args);
        computed.set(key, structuredClone(value));
        memo.set(key, value);
      }
      return memo.get(key);
    };

  return {
    mockGetUser: vi.fn(),
    mockAuthGetUser: vi.fn(),
    mockGetUsers: vi.fn(),
    mockListUsers: vi.fn(),
    mockBuild: vi.fn(),
    userDocs: new Map<string, Record<string, unknown>>(),
    headers: new Map<string, string>(),
    memo,
    computed,
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

vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: mockAuthGetUser,
    getUsers: mockGetUsers,
    listUsers: mockListUsers,
  }),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({ collection: name, id }),
    }),
    // Drops the trailing `ReadOptions` (the `publicProfile` field mask).
    getAll: async (...args: { collection?: string; id?: string }[]) =>
      args
        .filter((arg): arg is { collection: string; id: string } => !!arg.id)
        .map((ref) => ({ id: ref.id, data: () => userDocs.get(ref.id) })),
  }),
}));

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("~~/server/utils/activityFeed", () => ({
  buildActivityFeed: mockBuild,
}));

const call = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<ActivityFeed>)({ query });

const NOW = new Date("2026-09-22T12:00:00.000Z");
const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

// Distinctive enough that a substring search of a whole response body means
// something.
const ESTABLISHED = "uidEstablishedAdmin01";
const TRIAL = "uidTrialAdmin02";
const ANNA = "uidAnnaPublic03";
const BARTEK = "uidBartekMasked04";
const CELINA = "uidCelinaMasked05";
const FORGER = "uidForger06";
const NAMELESS = "uidNameless07";
const READER = "uidReader08";

type Account = {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  customClaims?: Record<string, unknown>;
};

const accounts: Account[] = [
  {
    uid: ESTABLISHED,
    displayName: "Szymon Pajzert",
    email: "szymon@example.com",
    customClaims: { admin: true },
  },
  {
    uid: TRIAL,
    displayName: "Mikołaj Próbny",
    email: "mikolaj@example.com",
    photoURL: "https://example.com/mikolaj.png",
    customClaims: { admin: true, newAdmin: true },
  },
  { uid: ANNA, displayName: "Anna Nowak", email: "anna@example.com" },
  { uid: BARTEK, displayName: "Bartosz Lis", email: "bartosz@example.com" },
  { uid: CELINA, displayName: "Celina Wróbel", email: "celina@example.com" },
  {
    uid: FORGER,
    displayName: "Fałszerz Kowalski",
    email: "falszerz@example.com",
    // Left over from a trial that ended by demotion.
    customClaims: { newAdmin: true },
  },
  { uid: NAMELESS, email: "nameless@example.com" },
  { uid: READER, email: "reader@example.com" },
];

const directory = new Map(accounts.map((account) => [account.uid, account]));

const batch = (
  uid: string,
  kind: RawFeedBatch["kind"],
  hours: number,
  // Ids of their own, never built from the uid: a fixture that put the uid in
  // a page id would fail the leak checks for a reason that is not a leak.
  targets: RawFeedBatch["targets"] = [
    {
      id: `p-${kind}-${hours}`,
      type: "person",
      name: "Jan Kowalski",
      href: `/entity/person/p-${kind}-${hours}`,
    },
  ],
): RawFeedBatch => ({
  uid,
  kind,
  firstAt: hoursAgo(hours + 0.5),
  lastAt: hoursAgo(hours),
  count: targets.length,
  objects: { person: targets.length },
  alongEdges: 0,
  targets,
  moreTargets: 0,
});

/** Newest first, as the util hands it over. */
const rawFeed = (): RawFeed => ({
  batches: [
    batch(TRIAL, "approve", 1, [
      {
        id: "p1",
        type: "person",
        name: "Jan Kowalski",
        href: "/entity/person/p1",
        revisionId: `proposal_p1_${TRIAL}_abc`,
        selfApproved: true,
      },
    ]),
    batch(BARTEK, "vote", 2),
    batch(TRIAL, "reject", 3, [
      {
        id: "p2",
        type: "person",
        name: "Ewa Zielińska",
        href: "/entity/person/p2",
        revisionId: `proposal_p2_${ANNA}_def`,
        reason: "Brak źródła dla tej zmiany",
      },
    ]),
    batch(ANNA, "proposal", 4, [
      {
        id: "p3",
        type: "person",
        name: "Adam Mazur",
        href: "/entity/person/p3",
        revisionId: `proposal_p3_${ANNA}_111`,
      },
      {
        id: "p3",
        type: "person",
        name: "Adam Mazur",
        href: "/entity/person/p3",
        revisionId: `proposal_p3_${ANNA}_222`,
      },
    ]),
    batch(CELINA, "vote", 5),
    batch(FORGER, "edit", 6),
    batch(ESTABLISHED, "edit", 7),
    batch(ESTABLISHED, "reject", 8),
    batch(BARTEK, "note", 9),
    batch(TRIAL, "import", 10),
    batch(NAMELESS, "delete", 11, [
      {
        id: "e1",
        type: "edge",
        name: "Adam Mazur → ORLEN",
        href: null,
        deleted: true,
        reason: "Duplikat",
      },
    ]),
  ],
  truncated: ["votes"],
});

const established = { uid: ESTABLISHED, admin: true };
const trial = { uid: TRIAL, admin: true, newAdmin: true };
const reader = { uid: READER };
const bartek = { uid: BARTEK };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  headers.clear();
  userDocs.clear();
  memo.clear();
  computed.clear();

  userDocs.set(ANNA, { publicProfile: true });
  userDocs.set(BARTEK, { publicProfile: false });

  mockBuild.mockImplementation(async () => rawFeed());
  // The account as it is now, which a token can lag behind.
  mockAuthGetUser.mockImplementation(async (uid: string) => {
    const account = directory.get(uid);
    if (!account) {
      throw Object.assign(new Error("no such user"), {
        code: "auth/user-not-found",
      });
    }
    return account;
  });
  mockGetUsers.mockImplementation(async (ids: { uid: string }[]) => ({
    users: ids.flatMap(({ uid }) => directory.get(uid) ?? []),
    notFound: [],
  }));
  // Two pages, the administrator on trial on the second.
  mockListUsers.mockImplementation(async (_max: number, token?: string) =>
    token === "page-2"
      ? { users: accounts.filter((account) => account.uid === TRIAL) }
      : {
          users: accounts.filter((account) => account.uid !== TRIAL),
          pageToken: "page-2",
        },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/activity/feed", () => {
  it("refuses a signed-out caller", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
    );

    await expect(call()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("marks every response uncacheable, since each names its caller", async () => {
    mockGetUser.mockResolvedValue(reader);

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("defaults to a week and honours the other offered range", async () => {
    mockGetUser.mockResolvedValue(reader);

    expect((await call()).window.days).toBe(7);
    for (const days of feedRanges) {
      expect((await call({ days: String(days) })).window.days).toBe(days);
    }
  });

  it("refuses any other range", async () => {
    // Every distinct value is its own memo entry and its own scan.
    mockGetUser.mockResolvedValue(reader);

    for (const days of ["0", "1", "14", "90", "3650", "nie"]) {
      await expect(call({ days })).rejects.toThrow();
    }
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("scans a little past now, and reports the window as ending now", async () => {
    mockGetUser.mockResolvedValue(reader);

    const result = await call({ days: "30" });

    expect(mockBuild).toHaveBeenCalledWith(expect.anything(), {
      sinceIso: "2026-08-23T12:00:00.000Z",
      untilIso: "2026-09-22T12:10:00.000Z",
      newAdminUids: [TRIAL],
    });
    expect(result.window).toEqual({
      since: "2026-08-23T12:00:00.000Z",
      until: "2026-09-22T12:00:00.000Z",
      days: 30,
    });
  });

  describe("for an established administrator", () => {
    it("names and identifies every actor", async () => {
      mockGetUser.mockResolvedValue(established);

      const result = await call();

      expect(result.identified).toBe(true);
      expect(result.actors.map((actor) => actor.key)).toEqual([
        TRIAL,
        BARTEK,
        ANNA,
        CELINA,
        ESTABLISHED,
        NAMELESS,
      ]);
      expect(result.actors.every((actor) => actor.key === actor.uid)).toBe(
        true,
      );
      expect(result.actors.find((a) => a.uid === TRIAL)).toMatchObject({
        name: "Mikołaj Próbny",
        named: true,
        newAdmin: true,
        photoURL: null,
      });
      expect(result.actors.find((a) => a.uid === ESTABLISHED)).toMatchObject({
        isSelf: true,
        newAdmin: false,
      });
      // No display name: the address, which an administrator may see.
      expect(result.actors.find((a) => a.uid === NAMELESS)!.name).toBe(
        "nameless@example.com",
      );
      // An avatar is a URL of the account holder's choosing, fetched by every
      // browser that renders it - not even an administrator's gets one.
      expect(JSON.stringify(result)).not.toContain("mikolaj.png");
    });

    it("tells them whether the contributors see their own name", async () => {
      // Every name is shown to an administrator, their own included, so
      // `named` says nothing about what anybody else sees.
      mockGetUser.mockResolvedValue(established);

      const self = (await call()).actors.find((actor) => actor.isSelf)!;

      expect(self).toMatchObject({ named: true, publicName: false });

      memo.clear();
      userDocs.set(ESTABLISHED, { publicProfile: true });
      const again = (await call()).actors.find((actor) => actor.isSelf)!;

      expect(again).toMatchObject({ named: true, publicName: true });
    });

    it("sends the reasons, revision links and self-approval flags", async () => {
      mockGetUser.mockResolvedValue(established);

      const result = await call();

      const approve = result.batches.find((b) => b.kind === "approve")!;
      expect(approve.targets[0]).toEqual({
        key: "person:p1",
        type: "person",
        name: "Jan Kowalski",
        href: "/entity/person/p1",
        revisionHref: `/admin/rewizje?rewizja=proposal_p1_${TRIAL}_abc#kolejka`,
        selfApproved: true,
      });
      const removal = result.batches.find((b) => b.kind === "delete")!;
      expect(removal.targets[0]).toMatchObject({
        deleted: true,
        href: null,
        reason: "Duplikat",
      });
      expect(approve.id).toBe(`${TRIAL}:approve:${hoursAgo(1.5)}`);
    });

    it("lists every administrator on trial, active or not", async () => {
      mockGetUser.mockResolvedValue(established);

      const result = await call();

      expect(result.newAdmins).toEqual([
        {
          key: TRIAL,
          uid: TRIAL,
          name: "Mikołaj Próbny",
          named: true,
          isSelf: false,
          photoURL: null,
          newAdmin: true,
        },
      ]);
      // A leftover `newAdmin` without `admin` is not a trial.
      expect(mockBuild.mock.calls[0]![1].newAdminUids).toEqual([TRIAL]);
    });

    it("sees rejections and imports", async () => {
      mockGetUser.mockResolvedValue(established);

      const kinds = (await call()).batches.map((b) => b.kind);

      expect(kinds).toContain("reject");
      expect(kinds).toContain("import");
    });
  });

  it("drops direct edits by anybody who is not an administrator", async () => {
    // A self-approved revision from a non-admin is legacy or forged through
    // the client SDK, not a decision.
    mockGetUser.mockResolvedValue(established);

    const edits = (await call()).batches.filter((b) => b.kind === "edit");

    expect(edits.map((b) => b.actorKey)).toEqual([ESTABLISHED]);
  });

  it("gives an administrator on trial the contributor view", async () => {
    mockGetUser.mockResolvedValue(trial);

    const result = await call();

    expect(result.identified).toBe(false);
    expect(result.newAdmins).toEqual([]);
    expect(result.actors.every((actor) => actor.uid === null)).toBe(true);
    expect(result.actors.every((actor) => !actor.newAdmin)).toBe(true);
    // Their own rejection and import, but nobody else's rejection.
    const restricted = result.batches.filter(
      (b) => b.kind === "reject" || b.kind === "import",
    );
    expect(restricted.map((b) => [b.actorKey, b.kind])).toEqual([
      ["self", "reject"],
      ["self", "import"],
    ]);
    // Their own lines still carry no revision link or reason: a proposal's id
    // embeds its author's uid, and the author here is somebody else.
    const body = JSON.stringify(result);
    expect(body).not.toContain("revisionHref");
    expect(body).not.toContain("Brak źródła");
    expect(body).not.toContain(ANNA);
  });

  describe("with a token older than the account's claims", () => {
    it("gives an administrator put on trial since the token the contributor view", async () => {
      // The claims script adds `newAdmin` to an account that is already an
      // administrator, and the token they hold says plain `admin` for up to
      // an hour afterwards.
      mockGetUser.mockResolvedValue({ uid: TRIAL, admin: true });

      const result = await call();

      expect(mockAuthGetUser).toHaveBeenCalledWith(TRIAL);
      expect(result.identified).toBe(false);
      expect(result.newAdmins).toEqual([]);
      expect(result.actors.every((actor) => actor.uid === null)).toBe(true);
      expect(result.actors.every((actor) => !actor.newAdmin)).toBe(true);
      const targets = result.batches.flatMap((b) => b.targets);
      for (const target of targets) {
        expect(target).not.toHaveProperty("revisionHref");
        expect(target).not.toHaveProperty("reason");
        expect(target).not.toHaveProperty("selfApproved");
      }
      const body = JSON.stringify(result);
      for (const account of accounts) {
        expect(body).not.toContain(account.uid);
      }
      expect(body).not.toContain("Brak źródła");
      expect(body).not.toContain("Duplikat");
    });

    it("gives an administrator demoted since the token the contributor view", async () => {
      mockGetUser.mockResolvedValue(established);
      mockAuthGetUser.mockResolvedValue({ uid: ESTABLISHED, customClaims: {} });

      const result = await call();

      expect(result.identified).toBe(false);
      expect(JSON.stringify(result)).not.toContain(TRIAL);
    });

    it("gives an account deleted since the token the contributor view", async () => {
      mockGetUser.mockResolvedValue({ uid: "uidDeletedAdmin09", admin: true });

      const result = await call();

      expect(result.identified).toBe(false);
      expect(result.newAdmins).toEqual([]);
    });

    it("asks the account only when the token says established administrator", async () => {
      // Everybody else gets the contributor view whatever the account says,
      // so a lookup for them would be a cost on every request for nothing.
      mockGetUser.mockResolvedValue(reader);
      await call();
      mockGetUser.mockResolvedValue(trial);
      await call();
      expect(mockAuthGetUser).not.toHaveBeenCalled();

      mockGetUser.mockResolvedValue(established);
      expect((await call()).identified).toBe(true);
      expect(mockAuthGetUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("for a contributor", () => {
    it("masks everybody who did not opt in, numbered as they appear", async () => {
      mockGetUser.mockResolvedValue(reader);

      const result = await call();

      expect(result.identified).toBe(false);
      expect(
        result.actors.map(({ key, name, named }) => [key, name, named]),
      ).toEqual([
        ["anon-1", "Anonim 1", false],
        ["anon-2", "Anonim 2", false],
        ["named-1", "Anna Nowak", true],
        ["anon-3", "Anonim 3", false],
        ["anon-4", "Anonim 4", false],
        ["anon-5", "Anonim 5", false],
      ]);
      expect(result.actors.every((actor) => actor.uid === null)).toBe(true);
    });

    it("names the caller's own lines to them", async () => {
      mockGetUser.mockResolvedValue(bartek);

      const result = await call();

      const self = result.actors.find((actor) => actor.isSelf)!;
      expect(self).toEqual({
        key: "self",
        uid: null,
        name: "Bartosz Lis",
        named: true,
        isSelf: true,
        photoURL: null,
        newAdmin: false,
        // ...and says that nobody else sees it: Bartosz never turned it on.
        publicName: false,
      });
      expect(
        result.batches.filter((b) => b.actorKey === "self").map((b) => b.kind),
      ).toEqual(["vote", "note"]);
    });

    it("tells a caller who went public that everybody sees their name", async () => {
      mockGetUser.mockResolvedValue({ uid: ANNA });

      const result = await call();

      expect(result.actors.find((actor) => actor.isSelf)).toMatchObject({
        name: "Anna Nowak",
        named: true,
        publicName: true,
      });
      // Nobody else's actor carries it: it answers a question about yourself.
      expect(
        result.actors.filter((actor) => "publicName" in actor),
      ).toHaveLength(1);
    });

    it("gives a caller with no display name a fallback that is not 'Ty'", async () => {
      // The chip adds "· Ty" to your own line, so "Ty" here read "Ty · Ty".
      // Public or not, a blank is masked for everybody else.
      userDocs.set(NAMELESS, { publicProfile: true });
      mockGetUser.mockResolvedValue({ uid: NAMELESS });

      const result = await call();

      expect(result.actors.find((actor) => actor.isSelf)).toMatchObject({
        key: "self",
        name: "Bez nazwy",
        named: false,
        publicName: false,
      });
    });

    it("hides rejections and imports", async () => {
      mockGetUser.mockResolvedValue(reader);

      const kinds = (await call()).batches.map((b) => b.kind);

      expect(kinds).not.toContain("reject");
      expect(kinds).not.toContain("import");
    });

    it("sends no revision link, reason or self-approval flag", async () => {
      mockGetUser.mockResolvedValue(reader);

      const targets = (await call()).batches.flatMap((b) => b.targets);

      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target).not.toHaveProperty("revisionHref");
        expect(target).not.toHaveProperty("reason");
        expect(target).not.toHaveProperty("selfApproved");
      }
      // A removed page still says so; that is not about who removed it.
      expect(targets.find((t) => t.key === "edge:e1")).toMatchObject({
        deleted: true,
      });
    });

    it("keys the same page twice in a batch apart without a revision id", async () => {
      mockGetUser.mockResolvedValue(reader);

      const proposal = (await call()).batches.find(
        (b) => b.kind === "proposal",
      )!;

      expect(proposal.targets.map((t) => t.key)).toEqual([
        "person:p3",
        "person:p3:2",
      ]);
    });

    it("builds batch ids from the masked key, never the uid", async () => {
      mockGetUser.mockResolvedValue(reader);

      const result = await call();

      expect(result.batches[0]!.id).toBe(`anon-1:approve:${hoursAgo(1.5)}`);
    });
  });

  it("presents one shared memo per caller without writing into it", async () => {
    mockGetUser.mockResolvedValue(established);
    const first = await call();
    mockGetUser.mockResolvedValue(reader);
    const second = await call();
    mockGetUser.mockResolvedValue(established);
    const third = await call();

    // One computation, served three times.
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(memo.get("7")).toEqual(computed.get("7"));
    expect(third).toEqual(first);

    const adminBody = JSON.stringify(first);
    const readerBody = JSON.stringify(second);
    const secrets = [
      ...accounts.map((account) => account.uid),
      ...accounts.flatMap((account) => account.email ?? []),
      "Szymon Pajzert",
      "Mikołaj Próbny",
      "Bartosz Lis",
      "Celina Wróbel",
      "mikolaj.png",
    ];
    for (const secret of secrets) {
      expect(readerBody).not.toContain(secret);
    }
    // ...and the list means something: the administrator's copy has them.
    for (const uid of [ESTABLISHED, TRIAL, ANNA, BARTEK, CELINA, NAMELESS]) {
      expect(adminBody).toContain(uid);
    }
  });

  it("passes on which sources were cut short by their scan cap", async () => {
    mockGetUser.mockResolvedValue(reader);

    expect((await call()).truncated).toEqual(["votes"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRecord } from "firebase-admin/auth";
import {
  buildUserRow,
  isActiveAccount,
  readAccount,
  readAccounts,
  readNomination,
  toDirectoryAccount,
  userLinks,
  walkAccounts,
  type AccountRecords,
  type DirectoryAccount,
} from "../../../server/utils/userDirectory";

const { mockListUsers, mockGetUsers, mockGetUser } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).defineCachedFunction = (
    fn: unknown,
  ) => fn;
  return {
    mockListUsers: vi.fn(),
    mockGetUsers: vi.fn(),
    mockGetUser: vi.fn(),
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    listUsers: mockListUsers,
    getUsers: mockGetUsers,
    getUser: mockGetUser,
  }),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(),
  Timestamp: { fromMillis: (millis: number) => ({ millis }) },
}));

vi.mock("~~/server/utils/activityWindow", () => ({
  cachedActivityWindow: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-05T12:00:00Z");

/** A `UserRecord` as the admin SDK hands it out. */
function record(uid: string, fields: Partial<UserRecord> = {}): UserRecord {
  return {
    uid,
    emailVerified: false,
    disabled: false,
    providerData: [],
    metadata: {
      creationTime: "Mon, 01 Sep 2026 10:00:00 GMT",
      lastSignInTime: "Fri, 03 Oct 2026 08:30:00 GMT",
      lastRefreshTime: null,
    },
    ...fields,
  } as unknown as UserRecord;
}

function account(fields: Partial<DirectoryAccount> = {}): DirectoryAccount {
  return {
    uid: "anna",
    displayName: "Anna",
    email: "anna@example.com",
    emailVerified: true,
    disabled: false,
    providers: ["google.com"],
    photoURL: null,
    createdAt: new Date(NOW.getTime() - 200 * DAY).toISOString(),
    lastSignInAt: null,
    lastRefreshAt: null,
    current: { level: "normal", trial: false, owner: false },
    ...fields,
  };
}

const none: AccountRecords = {
  nomination: null,
  stats: null,
  request: null,
  profile: null,
  activity: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toDirectoryAccount", () => {
  it("keeps what the page shows, times as ISO, the role from the claims", () => {
    const result = toDirectoryAccount(
      record("anna", {
        displayName: "Anna",
        email: "anna@example.com",
        emailVerified: true,
        photoURL: "https://example.com/a.png",
        providerData: [
          { providerId: "google.com" },
          { providerId: "password" },
        ] as UserRecord["providerData"],
        customClaims: {
          trusted: true,
          datascience: true,
          admin: true,
          newAdmin: true,
        },
        metadata: {
          creationTime: "Mon, 01 Sep 2026 10:00:00 GMT",
          lastSignInTime: "Fri, 03 Oct 2026 08:30:00 GMT",
          lastRefreshTime: "Sun, 05 Oct 2026 11:59:00 GMT",
        } as UserRecord["metadata"],
      }),
    );

    expect(result).toEqual({
      uid: "anna",
      displayName: "Anna",
      email: "anna@example.com",
      emailVerified: true,
      disabled: false,
      providers: ["google.com", "password"],
      photoURL: "https://example.com/a.png",
      createdAt: "2026-09-01T10:00:00.000Z",
      lastSignInAt: "2026-10-03T08:30:00.000Z",
      lastRefreshAt: "2026-10-05T11:59:00.000Z",
      current: { level: "admin", trial: true, owner: false },
    });
  });

  it("fills the gaps of an account made from a custom token", () => {
    expect(
      toDirectoryAccount(
        record("pipeline-people-import", {
          metadata: {
            creationTime: "",
            lastSignInTime: "not a date",
            lastRefreshTime: null,
          } as unknown as UserRecord["metadata"],
        }),
      ),
    ).toMatchObject({
      displayName: null,
      email: null,
      photoURL: null,
      providers: [],
      createdAt: null,
      lastSignInAt: null,
      lastRefreshAt: null,
      current: { level: "normal", trial: false, owner: false },
    });
  });
});

describe("walkAccounts", () => {
  it("walks every page", async () => {
    mockListUsers
      .mockResolvedValueOnce({ users: [record("a")], pageToken: "p2" })
      .mockResolvedValueOnce({ users: [record("b")], pageToken: undefined });

    const result = await walkAccounts();

    expect(result.truncated).toBe(false);
    expect(result.accounts.map((a) => a.uid)).toEqual(["a", "b"]);
    expect(mockListUsers.mock.calls).toEqual([
      [1000, undefined],
      [1000, "p2"],
    ]);
  });

  it("stops after ten pages and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let page = 0;
    mockListUsers.mockImplementation(async () => ({
      users: [record(`u${page++}`)],
      pageToken: "more",
    }));

    const result = await walkAccounts();

    expect(mockListUsers).toHaveBeenCalledTimes(10);
    expect(result.truncated).toBe(true);
    expect(result.accounts).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("10 pages"));
    warn.mockRestore();
  });
});

describe("readAccounts", () => {
  it("asks Auth a hundred at a time, and never about a non-uid", async () => {
    mockGetUsers.mockImplementation(async (ids: { uid: string }[]) => ({
      users: ids.map(({ uid }) => record(uid)),
      notFound: [],
    }));
    const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);

    const found = await readAccounts([
      ...uids,
      "u0",
      "migration:merge-duplicate-people",
      "script:set_auth_claims@laptop",
      "",
    ]);

    expect(mockGetUsers.mock.calls.map(([ids]) => ids.length)).toEqual([
      100, 100, 50,
    ]);
    expect(found.size).toBe(250);
  });
});

describe("readAccount", () => {
  it("is null for an account that does not exist", async () => {
    mockGetUser.mockRejectedValue(
      Object.assign(new Error("gone"), { code: "auth/user-not-found" }),
    );
    expect(await readAccount("gone")).toBeNull();
  });

  it("passes any other failure on", async () => {
    mockGetUser.mockRejectedValue(new Error("quota"));
    await expect(readAccount("anna")).rejects.toThrow("quota");
  });
});

describe("readNomination", () => {
  it("reads what the site and the script write", () => {
    expect(
      readNomination("anna", {
        desired: {
          level: "datascience",
          // A trial means nothing below admin, whoever wrote it.
          trial: true,
          reason: "Import",
          by: "boss",
          at: "2026-10-01T00:00:00Z",
        },
        applied: null,
        trialStartedAt: null,
        applyError: null,
      }),
    ).toEqual({
      desired: {
        level: "datascience",
        trial: false,
        reason: "Import",
        by: "boss",
        at: "2026-10-01T00:00:00Z",
      },
      trialStartedAt: null,
      applyError: null,
    });
  });

  it("leaves out a document with no level it knows", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      readNomination("anna", {
        desired: { level: "superadmin" },
      } as never),
    ).toBeNull();
    expect(readNomination("anna", {})).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("isActiveAccount", () => {
  const stats = {
    signIns: 1,
    activeDays: 1,
    firstSeenAt: "2026-10-01T00:00:00Z",
    lastSeenAt: "2026-10-01T00:00:00Z",
  };

  it.each<
    [string, Partial<DirectoryAccount>, Partial<AccountRecords>, boolean]
  >([
    ["a dormant account", {}, {}, false],
    [
      "a role",
      { current: { level: "trusted", trial: false, owner: false } },
      {},
      true,
    ],
    [
      "a nomination",
      {},
      {
        nomination: {
          desired: {
            level: "trusted",
            trial: false,
            reason: "x",
            by: "b",
            at: "",
          },
          trialStartedAt: null,
          applyError: null,
        },
      },
      true,
    ],
    [
      "a request",
      {},
      {
        request: {
          reason: "Chcę",
          source: "pomoc",
          createdAt: "2026-10-01T00:00:00Z",
          status: "dismissed",
        },
      },
      true,
    ],
    ["recorded sign-ins", {}, { stats }, true],
    [
      "activity in the window",
      {},
      {
        activity: {
          counts: { vote: 1, revision: 0, noteSource: 0, publication: 0 },
          total: 1,
          lastActiveAt: "2026-10-01T00:00:00Z",
        },
      },
      true,
    ],
    [
      "an account opened 30 days ago",
      { createdAt: new Date(NOW.getTime() - 30 * DAY).toISOString() },
      {},
      true,
    ],
    [
      "an account opened 31 days ago",
      { createdAt: new Date(NOW.getTime() - 31 * DAY).toISOString() },
      {},
      false,
    ],
    ["an account with no creation time", { createdAt: null }, {}, false],
    [
      "a pipeline login with sign-ins",
      { uid: "pipeline-people-import" },
      { stats },
      false,
    ],
    [
      "a pipeline login opened yesterday",
      {
        uid: "pipeline-people-import",
        createdAt: new Date(NOW.getTime() - DAY).toISOString(),
      },
      {},
      false,
    ],
    [
      "a robot holding a claim",
      {
        uid: "pipeline-legacy",
        current: { level: "datascience", trial: false, owner: false },
      },
      {},
      true,
    ],
  ])("%s", (_label, fields, records, expected) => {
    expect(isActiveAccount(account(fields), { ...none, ...records }, NOW)).toBe(
      expected,
    );
  });
});

describe("buildUserRow", () => {
  it("compares the wish with the live role, not with the script's receipt", () => {
    const row = buildUserRow(
      account({ current: { level: "trusted", trial: false, owner: false } }),
      {
        ...none,
        nomination: {
          desired: {
            level: "admin",
            trial: true,
            reason: "Awans",
            by: "boss",
            at: "2026-10-04T00:00:00Z",
          },
          trialStartedAt: "2026-09-20T00:00:00Z",
          applyError: { at: "2026-10-04T01:00:00Z", message: "brak konta" },
        },
        publicProfile: false,
      },
      { boss: "Szefowa" },
    );

    expect(row.nomination).toEqual({
      desired: {
        level: "admin",
        trial: true,
        reason: "Awans",
        by: "boss",
        byName: "Szefowa",
        at: "2026-10-04T00:00:00Z",
      },
      pending: true,
      applyError: { at: "2026-10-04T01:00:00Z", message: "brak konta" },
    });
    expect(row.trialStartedAt).toBe("2026-09-20T00:00:00Z");
  });

  it("is not pending once the account holds the wish", () => {
    const row = buildUserRow(
      account({ current: { level: "admin", trial: false, owner: true } }),
      {
        ...none,
        nomination: {
          desired: {
            level: "admin",
            trial: false,
            reason: "x",
            by: "migration:set_auth_claims",
            at: "",
          },
          trialStartedAt: null,
          applyError: null,
        },
        publicProfile: false,
      },
      {},
    );
    expect(row.nomination?.pending).toBe(false);
    expect(row.nomination?.desired.byName).toBeNull();
  });

  it("says nothing it was not given", () => {
    const row = buildUserRow(account(), { ...none, publicProfile: false }, {});
    expect(row).toMatchObject({
      nomination: null,
      trialStartedAt: null,
      signIns: null,
      activity: null,
      accessRequest: null,
      profile: { handle: null, public: false, hidden: false },
      robot: false,
    });
  });

  it("shows a hidden profile as hidden, and only its handle", () => {
    const row = buildUserRow(
      account(),
      {
        ...none,
        profile: {
          handle: "anna",
          hidden: {
            by: "boss",
            at: "2026-10-04T00:00:00Z",
            reason: "Podszywa się",
          },
        },
        publicProfile: true,
      },
      {},
    );
    expect(row.profile).toEqual({ handle: "anna", public: true, hidden: true });
  });
});

describe("userLinks", () => {
  it("escapes the uid and offers the profile only when anybody may open it", () => {
    const row = buildUserRow(
      account({ uid: "a/b" }),
      {
        ...none,
        profile: { handle: "ab", hidden: null },
        publicProfile: false,
      },
      {},
    );
    expect(userLinks(row)).toEqual({
      revisions: "/admin/rewizje?author=a%2Fb&status=all&automatic=all#kolejka",
      activity: "/aktywnosc?kto=a%2Fb",
      profile: null,
    });
    expect(
      userLinks({ ...row, profile: { ...row.profile, public: true } }).profile,
    ).toBe("/uczestnik/ab");
  });
});

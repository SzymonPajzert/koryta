import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { loadAudience, queueToCheck } from "../../../server/utils/mailAudience";
import { daysBetween } from "../../../server/utils/activityStats";
import type { DailyRollup } from "../../../server/utils/activityRollup";
import {
  emptyActivityCounts,
  type ActivityCounts,
} from "../../../shared/activity";
import { campaignEligibility, campaignTopics } from "../../../shared/campaigns";
import {
  confirmedSubscriber,
  loadConsent,
  type AccountRecord,
} from "../../../shared/campaignConsent";

const { mockListUsers, mockLoadRollups, mockSubscribers } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockLoadRollups: vi.fn(),
  mockSubscribers: vi.fn(),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ listUsers: mockListUsers }),
}));

vi.mock("~~/server/utils/activityWindow", () => ({
  loadActivityRollups: mockLoadRollups,
}));

vi.mock("~~/server/utils/newsletterSubscribers", () => ({
  confirmedSubscribers: mockSubscribers,
}));

const NOW = new Date("2026-10-09T12:00:00Z");
const SPANNED = daysBetween("2026-07-12", "2026-10-09");

/** `users/<uid>` documents, as the owners wrote them. */
let userDocs: Record<string, Record<string, unknown>> = {};
const getAll = vi.fn(async (...args: unknown[]) =>
  (args.filter((a) => (a as { id?: string }).id) as { id: string }[]).map(
    (ref) => ({ id: ref.id, data: () => userDocs[ref.id] }),
  ),
);
const db = {
  collection: () => ({ doc: (id: string) => ({ id }) }),
  getAll,
} as unknown as Firestore;

function account(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    displayName: uid.toUpperCase(),
    customClaims: undefined,
    metadata: {
      creationTime: "Mon, 05 Jan 2026 10:00:00 GMT",
      lastSignInTime: "Tue, 01 Sep 2026 10:00:00 GMT",
      lastRefreshTime: null,
    },
    ...overrides,
  };
}

function counts(partial: Partial<ActivityCounts>): ActivityCounts {
  return { ...emptyActivityCounts(), ...partial };
}

function day(
  date: string,
  contributors: Record<string, Partial<ActivityCounts>>,
): DailyRollup {
  const totals = emptyActivityCounts();
  const entries: DailyRollup["contributors"] = {};
  for (const [uid, partial] of Object.entries(contributors)) {
    const own = counts(partial);
    for (const kind of Object.keys(totals) as (keyof ActivityCounts)[]) {
      totals[kind] += own[kind];
    }
    entries[uid] = { counts: own, lastActiveAt: `${date}T09:00:00.000Z` };
  }
  return { date, totals, contributors: entries, truncated: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  userDocs = {};
  mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });
  mockSubscribers.mockResolvedValue([]);
  mockLoadRollups.mockResolvedValue({
    window: { since: SPANNED[0], until: SPANNED.at(-1), days: 90 },
    spanned: SPANNED,
    rollups: [],
  });
});

describe("loadAudience", () => {
  it("lists readers who signed up without an account, unless the address has one", async () => {
    mockListUsers.mockResolvedValue({ users: [account("ania")] });
    mockSubscribers.mockResolvedValue([
      {
        id: "abc",
        email: "bez.konta@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: false },
      },
      // Also an account: written to as the account, never twice.
      {
        id: "def",
        email: "ania@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: true },
      },
    ]);

    const { members } = await loadAudience(db, { now: NOW });
    expect(members.map((m) => m.uid)).toEqual(["ania", "sub_abc"]);
    expect(members[1]).toMatchObject({
      kind: "subscriber",
      email: "bez.konta@example.com",
      emailVerified: true,
      admin: false,
      lastSeenAt: null,
      preferences: { newsletter: { callsToAction: true, recentPeople: false } },
    });
  });

  it("describes every account with its roles, address and choices", async () => {
    mockListUsers.mockResolvedValue({
      users: [
        account("ania", {
          customClaims: { admin: true, newAdmin: true },
          emailVerified: false,
        }),
        account("owner", { customClaims: { admin: true, owner: true } }),
      ],
    });
    userDocs = {
      ania: { newsletter: { callsToAction: true, recentPeople: "yes" } },
      owner: { teamMail: false, displayName: "ignored" },
    };

    const { members } = await loadAudience(db, { now: NOW });
    const ania = members.find((m) => m.uid === "ania")!;
    expect(ania).toMatchObject({
      email: "ania@example.com",
      emailVerified: false,
      displayName: "ANIA",
      admin: true,
      newAdmin: true,
      owner: false,
      createdAt: "2026-01-05T10:00:00.000Z",
      lastSignInAt: "2026-09-01T10:00:00.000Z",
    });
    // A value that is not a boolean is somebody's own document saying
    // something this code does not understand - not a yes.
    expect(ania.preferences).toEqual({ newsletter: { callsToAction: true } });
    expect(members.find((m) => m.uid === "owner")!).toMatchObject({
      owner: true,
      newAdmin: false,
      preferences: { teamMail: false },
    });
    // Only the two fields campaigns read leave Firestore.
    expect(getAll.mock.calls[0]!.at(-1)).toEqual({
      fieldMask: ["newsletter", "teamMail"],
    });
  });

  it("takes the latest of sign-in, open tab and contribution as last seen", async () => {
    mockListUsers.mockResolvedValue({
      users: [
        account("tab", {
          metadata: {
            creationTime: "Mon, 05 Jan 2026 10:00:00 GMT",
            lastSignInTime: "Tue, 01 Sep 2026 10:00:00 GMT",
            lastRefreshTime: "2026-10-08T20:00:00.000Z",
          },
        }),
        account("voter"),
        account("never", {
          metadata: {
            creationTime: "Mon, 05 Jan 2026 10:00:00 GMT",
            lastSignInTime: null,
            lastRefreshTime: null,
          },
        }),
      ],
    });
    mockLoadRollups.mockResolvedValue({
      window: {},
      spanned: SPANNED,
      rollups: [day("2026-10-05", { voter: { vote: 3 } })],
    });

    const { members } = await loadAudience(db, { now: NOW });
    expect(members.map((m) => [m.uid, m.lastSeenAt])).toEqual([
      // Most recently seen first, never seen last.
      ["tab", "2026-10-08T20:00:00.000Z"],
      ["voter", "2026-10-05T09:00:00.000Z"],
      ["never", null],
    ]);
    expect(members[1]!.activity).toEqual({
      counts: counts({ vote: 3 }),
      total: 3,
    });
  });

  it("counts what everybody did over the last 30 days, and passes the queue on", async () => {
    mockLoadRollups.mockResolvedValue({
      window: {},
      spanned: SPANNED,
      rollups: [
        // Outside the 30 days: in a reader's 90-day numbers, not the site's.
        day("2026-08-01", { old: { vote: 50, publication: 5 } }),
        day("2026-09-20", { a: { vote: 4 }, b: { vote: 1, publication: 2 } }),
        day("2026-10-09", { a: { vote: 2 }, c: { revision: 1 } }),
      ],
    });

    const { community } = await loadAudience(db, { now: NOW, toCheck: 1204 });
    expect(community).toEqual({
      days: 30,
      votes: 7,
      // c only proposed a change, so did not rate anybody.
      voters: 2,
      publications: 2,
      toCheck: 1204,
    });
  });

  it("walks every page of accounts", async () => {
    mockListUsers
      .mockResolvedValueOnce({ users: [account("a")], pageToken: "next" })
      .mockResolvedValueOnce({ users: [account("b")], pageToken: undefined });

    const { members } = await loadAudience(db, { now: NOW });
    expect(members.map((m) => m.uid).sort()).toEqual(["a", "b"]);
    expect(mockListUsers).toHaveBeenLastCalledWith(1000, "next");
  });
});

describe("the release of held campaign mail", () => {
  it("judges every reader as the send does, from the same records", async () => {
    // The send picks recipients from this audience; the release asks again
    // with loadConsent right before a held message goes. Fed the same
    // records, the two must never disagree about anybody.
    const accounts: AccountRecord[] = [
      account("fan"),
      account("admin", { customClaims: { admin: true } }),
      account("quiet-admin", { customClaims: { admin: true, newAdmin: true } }),
      account("unverified", { emailVerified: false }),
      account("blocked", { disabled: true }),
      account("no-address", { email: undefined }),
      account("odd"),
      account("ania"),
    ];
    userDocs = {
      fan: { newsletter: { callsToAction: true, recentPeople: false } },
      "quiet-admin": { teamMail: false, newsletter: { recentPeople: true } },
      unverified: { newsletter: { callsToAction: true } },
      blocked: { newsletter: { callsToAction: true } },
      odd: {
        newsletter: { callsToAction: "yes", recentPeople: 1 },
        teamMail: "no",
      },
    };
    const subscriberDocs: Record<string, Record<string, unknown>> = {
      abc: {
        email: "bez.konta@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: "tak" },
      },
      // Also an account: both write to it as the account.
      def: {
        email: "ania@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: true },
      },
    };
    mockListUsers.mockResolvedValue({ users: accounts });
    mockSubscribers.mockResolvedValue(
      Object.entries(subscriberDocs).map(([id, data]) => ({
        id,
        status: "confirmed",
        ...confirmedSubscriber(data)!,
      })),
    );

    const { members } = await loadAudience(db, { now: NOW });
    type Ref = { path: string; id: string };
    const consent = await loadConsent(
      {
        db: {
          collection: (name: string) => ({
            doc: (id: string): Ref => ({ path: `${name}/${id}`, id }),
          }),
          getAll: async (...args: unknown[]) =>
            (args.filter((arg) => (arg as Ref).path) as Ref[]).map((ref) => ({
              id: ref.id,
              data: () =>
                ref.path.startsWith("users/")
                  ? userDocs[ref.id]
                  : subscriberDocs[ref.id],
            })),
        },
        auth: {
          getUsers: async (ids) => ({
            users: accounts.filter((a) =>
              ids.some((id) =>
                "uid" in id ? id.uid === a.uid : id.email === a.email,
              ),
            ),
          }),
        },
      },
      [...members.map((member) => member.uid), "sub_def"],
    );

    expect(members.map((member) => member.uid)).not.toContain("sub_def");
    expect(consent.has("sub_def")).toBe(false);
    for (const member of members) {
      for (const topic of campaignTopics) {
        expect(
          campaignEligibility(consent.get(member.uid)!, topic),
          `${member.uid} about ${topic}`,
        ).toEqual(campaignEligibility(member, topic));
      }
    }
  });
});

describe("queueToCheck", () => {
  it("adds up the tiers it has a number for", async () => {
    const tiers = [
      { tier: 1, toCheck: 30, examples: [] },
      { tier: 2, toCheck: null, examples: [] },
      { tier: 3, toCheck: 12, examples: [] },
    ];
    expect(await queueToCheck(async () => ({ tiers }) as never)).toBe(42);
  });

  it("knows nothing rather than zero when no tier could be counted", async () => {
    expect(
      await queueToCheck(
        async () =>
          ({
            tiers: [{ tier: 1, toCheck: null, examples: [] }],
          }) as never,
      ),
    ).toBeNull();
    expect(
      await queueToCheck(async () => {
        throw new Error("down");
      }),
    ).toBeNull();
  });
});

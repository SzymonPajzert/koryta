import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  campaignDeliveries,
  queueCampaign,
  queueTest,
  saveCampaign,
} from "../../../server/utils/mailCampaigns";
import { mailToken, unsubscribe } from "../../../server/utils/mailTokens";
import { emptyActivityCounts } from "../../../shared/activity";
import type {
  AudienceMember,
  CampaignContent,
  CampaignRecord,
  CommunityStats,
} from "../../../shared/campaigns";

const { store, FieldValue, Timestamp } = vi.hoisted(() => {
  class Timestamp {
    constructor(readonly millis: number) {}
    static now() {
      return new Timestamp(Date.parse("2026-10-09T12:00:00Z"));
    }
    toDate() {
      return new Date(this.millis);
    }
  }
  return {
    Timestamp,
    /** Every document, by `collection/id`. */
    store: new Map<string, Record<string, unknown>>(),
    FieldValue: {
      arrayUnion: (...items: unknown[]) => ({ arrayUnion: items }),
    },
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue, Timestamp }));

/** Enough of Firestore for the store: documents with get, create, set (with
 * merge), update (with arrayUnion), and an equality query. */
function fakeDb(): Firestore {
  const docRef = (collection: string, id: string) => {
    const key = `${collection}/${id}`;
    return {
      id,
      get: async () => ({
        id,
        exists: store.has(key),
        data: () => store.get(key),
      }),
      create: async (data: Record<string, unknown>) => {
        if (store.has(key))
          throw Object.assign(new Error("exists"), { code: 6 });
        store.set(key, data);
      },
      set: async (
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        store.set(
          key,
          options?.merge ? deepMerge(store.get(key) ?? {}, data) : data,
        );
      },
      update: async (data: Record<string, unknown>) => {
        const current = store.get(key);
        if (!current) throw Object.assign(new Error("missing"), { code: 5 });
        const next = { ...current };
        for (const [field, value] of Object.entries(data)) {
          const union = (value as { arrayUnion?: unknown[] } | null)
            ?.arrayUnion;
          next[field] = union
            ? [
                ...((current[field] as unknown[] | undefined) ?? []),
                ...union.filter(
                  (item) =>
                    !((current[field] as unknown[] | undefined) ?? []).some(
                      (old) => JSON.stringify(old) === JSON.stringify(item),
                    ),
                ),
              ]
            : value;
        }
        store.set(key, next);
      },
    };
  };
  const query = (collection: string, filters: [string, unknown][]) => ({
    where: (field: string, _op: string, value: unknown) =>
      query(collection, [...filters, [field, value]]),
    select: () => query(collection, filters),
    get: async () => ({
      docs: [...store]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
        .map(([key, data]) => ({
          id: key.slice(collection.length + 1),
          data: () => data,
        })),
    }),
  });
  return {
    collection: (collection: string) => ({
      doc: (id: string) => docRef(collection, id),
      ...query(collection, []),
    }),
  } as unknown as Firestore;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(
            (target[key] as Record<string, unknown> | undefined) ?? {},
            value as Record<string, unknown>,
          )
        : value;
  }
  return out;
}

const CONTENT: CampaignContent = {
  subject: "Wracamy do kolejki!",
  body: "Cześć,\n\nkolejka czeka.",
  ctaLabel: "Sprawdź kolejną osobę",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: true,
};

const COMMUNITY: CommunityStats = {
  days: 30,
  votes: 100,
  voters: 5,
  publications: 3,
  toCheck: 40,
};

function member(
  uid: string,
  overrides: Partial<AudienceMember> = {},
): AudienceMember {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    displayName: null,
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: null,
    lastSignInAt: null,
    lastSeenAt: null,
    activity: { counts: { ...emptyActivityCounts(), vote: 4 }, total: 4 },
    preferences: {},
    ...overrides,
  };
}

let db: Firestore;
const NOW = new Date("2026-10-09T12:00:00Z");

beforeEach(() => {
  store.clear();
  db = fakeDb();
});

async function draft(): Promise<CampaignRecord> {
  return saveCampaign(db, { content: CONTENT, by: "owner", now: NOW });
}

describe("saveCampaign", () => {
  it("names a new campaign after its day and subject", async () => {
    const campaign = await draft();
    expect(campaign.id).toBe("2026-10-09-wracamy-do-kolejki");
    expect(campaign).toMatchObject({ ...CONTENT, recipients: [], sends: [] });

    // The same subject the same day is a second campaign, not an overwrite.
    expect((await draft()).id).toBe("2026-10-09-wracamy-do-kolejki-2");
  });

  it("edits the text of an existing one and keeps its history", async () => {
    const campaign = await draft();
    await queueCampaign(db, {
      campaign,
      members: [member("a", { admin: true })],
      community: COMMUNITY,
      uids: ["a"],
      by: "owner",
      siteUrl: "https://koryta.pl",
      now: NOW,
    });
    const edited = await saveCampaign(db, {
      id: campaign.id,
      content: { ...CONTENT, subject: "Poprawiony temat" },
      by: "owner",
      now: NOW,
    });
    expect(edited.subject).toBe("Poprawiony temat");
    expect(edited.recipients).toEqual(["a"]);
  });
});

describe("queueCampaign", () => {
  it("queues one message per eligible recipient, and says why the rest got none", async () => {
    const campaign = await draft();
    const members = [
      member("admin", { admin: true }),
      member("fan", { preferences: { newsletter: { callsToAction: true } } }),
      member("quiet"),
      member("unverified", { admin: true, emailVerified: false }),
    ];

    const { outcomes, campaign: after } = await queueCampaign(db, {
      campaign,
      members,
      community: COMMUNITY,
      uids: ["admin", "fan", "quiet", "unverified", "ghost"],
      by: "owner",
      siteUrl: "https://koryta.pl",
      now: NOW,
    });

    expect(outcomes).toEqual({
      admin: "queued",
      fan: "queued",
      // The page offered only eligible people, but the server does not take
      // the browser's word for it.
      quiet: "noConsent",
      unverified: "unverified",
      ghost: "unknown",
    });
    expect(after.recipients.sort()).toEqual(["admin", "fan"]);
    expect(after.sends).toEqual([
      {
        at: NOW.toISOString(),
        by: "owner",
        test: false,
        outcomes: { queued: 2, noConsent: 1, unverified: 1, unknown: 1 },
      },
    ]);

    const mail = store.get(`mail/campaign_${campaign.id}_fan`)!;
    expect(mail).toMatchObject({
      to: ["fan@example.com"],
      kind: "campaign",
      campaign: campaign.id,
      uid: "fan",
    });
    const message = mail.message as { subject: string; text: string };
    expect(message.subject).toBe("Wracamy do kolejki!");
    // Their own numbers and the site's, since the campaign asked for them.
    expect(message.text).toContain(
      "Twój wkład w ostatnich 90 dniach: 4 oceny.",
    );
    expect(message.text).toContain("W kolejce do sprawdzenia: 40 osób.");
    // The unsubscribe link carries this reader's own token, and the campaign.
    const token = (store.get("mailTokens/fan") as { token: string }).token;
    expect(message.text).toContain(
      `https://koryta.pl/wypisz?u=fan&t=${token}&k=callsToAction&c=${campaign.id}`,
    );
    expect(
      (mail.headers as Record<string, string>)["List-Unsubscribe"],
    ).toContain("/api/mail/unsubscribe?u=fan");
    expect(message.text).toContain("bo w ustawieniach profilu zapisano Cię");
    expect(
      (
        store.get(`mail/campaign_${campaign.id}_admin`)!.message as {
          text: string;
        }
      ).text,
    ).toContain("bo należysz do zespołu koryta.pl");
  });

  it("never sends one campaign to one person twice", async () => {
    const campaign = await draft();
    const members = [
      member("a", { admin: true }),
      member("b", { admin: true }),
    ];
    const send = (uids: string[]) =>
      queueCampaign(db, {
        campaign,
        members,
        community: COMMUNITY,
        uids,
        by: "owner",
        siteUrl: "https://koryta.pl",
        now: NOW,
      });

    await send(["a"]);
    const { outcomes, campaign: after } = await send(["a", "b"]);
    expect(outcomes).toEqual({ a: "duplicate", b: "queued" });
    expect(after.recipients).toEqual(["a", "b"]);
  });
});

describe("queueTest", () => {
  it("sends the owner their own copy, marked as a test, as often as asked", async () => {
    const campaign = await draft();
    const owner = member("owner", { admin: true, owner: true });

    const first = await queueTest(db, {
      campaign,
      member: owner,
      community: COMMUNITY,
      siteUrl: "https://koryta.pl",
      now: NOW,
    });
    const second = await queueTest(db, {
      campaign,
      member: owner,
      community: COMMUNITY,
      siteUrl: "https://koryta.pl",
      now: new Date(NOW.getTime() + 1000),
    });

    expect([first.outcome, second.outcome]).toEqual(["queued", "queued"]);
    const tests = [...store]
      .filter(([key]) => key.startsWith(`mail/campaignTest_${campaign.id}_`))
      .map(([, data]) => data);
    expect(tests).toHaveLength(2);
    expect((tests[0]!.message as { subject: string }).subject).toBe(
      "[Test] Wracamy do kolejki!",
    );
    // A test is not a send: nobody is recorded as having received it.
    expect(second.campaign.recipients).toEqual([]);
    expect(second.campaign.sends.map((s) => s.test)).toEqual([true, true]);
  });

  it("refuses an address the owner never confirmed", async () => {
    const campaign = await draft();
    const { outcome } = await queueTest(db, {
      campaign,
      member: member("owner", { owner: true, emailVerified: false }),
      community: COMMUNITY,
      siteUrl: "https://koryta.pl",
      now: NOW,
    });
    expect(outcome).toBe("unverified");
  });
});

describe("campaignDeliveries", () => {
  it("reads back what the extension wrote on each message", async () => {
    const campaign = await draft();
    store.set(`mail/campaign_${campaign.id}_a`, {
      campaign: campaign.id,
      uid: "a",
      created_at: Timestamp.now(),
      delivery: {
        state: "SUCCESS",
        endTime: Timestamp.now(),
      },
    });
    store.set(`mail/campaign_${campaign.id}_b`, {
      campaign: campaign.id,
      uid: "b",
      created_at: Timestamp.now(),
      delivery: { state: "ERROR", error: "550 mailbox unavailable" },
    });
    store.set(`mail/campaign_${campaign.id}_c`, {
      campaign: campaign.id,
      uid: "c",
      created_at: Timestamp.now(),
    });
    store.set("mail/campaign_other_a", { campaign: "other", uid: "a" });

    expect(await campaignDeliveries(db, campaign.id)).toEqual({
      a: {
        state: "SUCCESS",
        queuedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        error: null,
      },
      b: {
        state: "ERROR",
        queuedAt: NOW.toISOString(),
        finishedAt: null,
        error: "550 mailbox unavailable",
      },
      // Nothing has picked it up: no extension, or not yet.
      c: {
        state: "queued",
        queuedAt: NOW.toISOString(),
        finishedAt: null,
        error: null,
      },
    });
  });
});

describe("mail tokens", () => {
  it("gives each account one token and keeps it", async () => {
    const first = await mailToken(db, "a");
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await mailToken(db, "a")).toBe(first);
    expect(await mailToken(db, "b")).not.toBe(first);
  });

  it("unsubscribes the holder of the right token from the topic and from team mail", async () => {
    const campaign = await draft();
    const token = await mailToken(db, "a");
    store.set("users/a", {
      newsletter: { callsToAction: true, recentPeople: true },
      displayName: "Anna",
    });

    expect(
      await unsubscribe(db, {
        uid: "a",
        token,
        topic: "callsToAction",
        campaignId: campaign.id,
      }),
    ).toBe("unsubscribed");
    expect(store.get("users/a")).toMatchObject({
      newsletter: { callsToAction: false, recentPeople: true },
      teamMail: false,
      displayName: "Anna",
    });
    expect(store.get(`mailCampaigns/${campaign.id}`)!.unsubscribed).toEqual([
      "a",
    ]);
  });

  it("refuses a wrong token, and an account that never got one", async () => {
    await mailToken(db, "a");
    expect(
      await unsubscribe(db, { uid: "a", token: "nope", topic: "recentPeople" }),
    ).toBe("invalid");
    expect(
      await unsubscribe(db, { uid: "b", token: "nope", topic: "recentPeople" }),
    ).toBe("invalid");
    expect(store.has("users/a")).toBe(false);
  });

  it("still unsubscribes when the campaign named in the link is gone", async () => {
    const token = await mailToken(db, "a");
    expect(
      await unsubscribe(db, {
        uid: "a",
        token,
        topic: "recentPeople",
        campaignId: "2020-01-01-usunieta",
      }),
    ).toBe("unsubscribed");
  });
});

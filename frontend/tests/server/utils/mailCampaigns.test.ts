import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  campaignDeliveries,
  campaignQueue,
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

const { store, FieldValue, Timestamp, getUsers } = vi.hoisted(() => {
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
      serverTimestamp: () => ({ serverTimestamp: true }),
    },
    /** The auth service: every uid asked for is an account with a confirmed
     * address at example.com, unless a test says otherwise. */
    getUsers: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue, Timestamp }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ getUsers }) }));

/** A stored time as milliseconds: a Date, or the Timestamp above. */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const toDate = (value as { toDate?: () => Date } | null)?.toDate;
  return typeof toDate === "function" ? toDate.call(value).getTime() : NaN;
}

/** The value at a dotted path, as a query reads `delivery.state`. */
function at(data: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown> | undefined)?.[key],
      data,
    );
}

function matches(
  data: Record<string, unknown>,
  [field, op, value]: [string, string, unknown],
): boolean {
  const stored = at(data, field);
  if (op === ">=") return millis(stored) >= millis(value);
  return stored === value;
}

/** Enough of Firestore for the store: documents with get, create, set (with
 * merge), update (with arrayUnion), `getAll`, transactions that write once
 * the body returns, and queries with `==` and `>=` (on times), `limit` and
 * `count`. */
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
  type Filter = [string, string, unknown];
  const query = (
    collection: string,
    filters: Filter[],
    limit = Infinity,
  ): Record<string, unknown> => {
    const docs = () =>
      [...store]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every((filter) => matches(data, filter)))
        .slice(0, limit)
        .map(([key, data]) => ({
          id: key.slice(collection.length + 1),
          ref: docRef(collection, key.slice(collection.length + 1)),
          data: () => data,
        }));
    return {
      where: (field: string, op: string, value: unknown) =>
        query(collection, [...filters, [field, op, value]], limit),
      select: () => query(collection, filters, limit),
      limit: (n: number) => query(collection, filters, n),
      count: () => ({
        get: async () => ({ data: () => ({ count: docs().length }) }),
      }),
      get: async () => ({ docs: docs() }),
    };
  };
  type Ref = ReturnType<typeof docRef>;
  return {
    collection: (collection: string) => ({
      doc: (id: string) => docRef(collection, id),
      ...query(collection, []),
    }),
    // References, then the read options.
    getAll: async (...args: unknown[]) =>
      Promise.all(
        (args.filter((arg) => "get" in (arg as object)) as Ref[]).map((ref) =>
          ref.get(),
        ),
      ),
    runTransaction: async <T>(body: (tx: unknown) => Promise<T>) => {
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: (ref: Ref) => ref.get(),
        create: (ref: Ref, data: Record<string, unknown>) =>
          writes.push(() => ref.create(data)),
        set: (ref: Ref, data: Record<string, unknown>) =>
          writes.push(() => ref.set(data)),
        update: (ref: Ref, data: Record<string, unknown>) =>
          writes.push(() => ref.update(data)),
      };
      const result = await body(tx);
      for (const write of writes) await write();
      return result;
    },
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
  getUsers.mockReset();
  getUsers.mockImplementation(
    async (identifiers: ({ uid: string } | { email: string })[]) => ({
      users: identifiers.flatMap((id) =>
        "uid" in id
          ? [
              {
                uid: id.uid,
                email: `${id.uid}@example.com`,
                emailVerified: true,
                disabled: false,
              },
            ]
          : [],
      ),
    }),
  );
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
      // What the release asks the reader's consent about again.
      topic: "callsToAction",
      uid: "fan",
      // Not sent yet: releaseCampaignMail lets it out with its batch.
      delivery: { state: "HELD" },
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
    expect(message.text).toContain("bo Twoje konto na koryta.pl jest zapisane");
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

  it("sends a failed delivery again, and nothing that went out or is on its way", async () => {
    const campaign = await draft();
    const earlier = (uid: string, delivery?: Record<string, unknown>) =>
      store.set(`mail/campaign_${campaign.id}_${uid}`, {
        to: [`${uid}@example.com`],
        message: { subject: "Stary temat", text: "", html: "" },
        kind: "campaign",
        campaign: campaign.id,
        uid,
        ...(delivery ? { delivery } : {}),
      });
    // The pilot's 11: refused by Mailgun, and never tried again.
    const refused =
      "Error: Message failed: 421 Domain koryta.pl is not allowed to send: recipient limit (26) exceeded";
    earlier("failed", { state: "ERROR", error: refused });
    earlier("sent", { state: "SUCCESS" });
    earlier("pending", { state: "PENDING" });
    earlier("sending", { state: "PROCESSING" });
    earlier("retrying", { state: "RETRY" });
    earlier("held", { state: "HELD" });
    // Written while the extension was not installed: nothing picked it up.
    earlier("untouched");
    // Failed too, but has left the topic since.
    earlier("left", { state: "ERROR", error: refused });
    // Left the team before its batch came, and has come back since.
    earlier("returned", { state: "WITHDRAWN" });

    const team = [
      "failed",
      "sent",
      "pending",
      "sending",
      "retrying",
      "held",
      "untouched",
      "returned",
      "new",
    ];
    const {
      outcomes,
      campaign: after,
      queue,
    } = await queueCampaign(db, {
      campaign,
      members: [
        ...team.map((uid) => member(uid, { admin: true })),
        member("left"),
      ],
      community: COMMUNITY,
      uids: [...team, "left"],
      by: "owner",
      siteUrl: "https://koryta.pl",
      now: NOW,
    });

    expect(outcomes).toEqual({
      failed: "requeued",
      sent: "duplicate",
      pending: "duplicate",
      sending: "duplicate",
      retrying: "duplicate",
      held: "duplicate",
      untouched: "duplicate",
      left: "noConsent",
      // Never went, so it is sent as to anybody new.
      returned: "queued",
      new: "queued",
    });
    expect(after.sends.at(-1)!.outcomes).toEqual({
      requeued: 1,
      duplicate: 6,
      noConsent: 1,
      queued: 2,
    });

    // Written afresh, with the campaign's text as it is now, and held back
    // for its batch like any other message.
    const again = store.get(`mail/campaign_${campaign.id}_failed`)!;
    expect(again).toMatchObject({
      to: ["failed@example.com"],
      delivery: { state: "HELD" },
    });
    expect((again.message as { subject: string }).subject).toBe(
      "Wracamy do kolejki!",
    );
    expect(store.get(`mail/campaign_${campaign.id}_sent`)).toMatchObject({
      message: { subject: "Stary temat" },
      delivery: { state: "SUCCESS" },
    });
    expect(store.get(`mail/campaign_${campaign.id}_left`)).toMatchObject({
      delivery: { state: "ERROR" },
    });
    expect(store.get(`mail/campaign_${campaign.id}_returned`)).toMatchObject({
      message: { subject: "Wracamy do kolejki!" },
      delivery: { state: "HELD" },
    });
    // The failed one, the withdrawn one, the new one, and the one that was
    // waiting already.
    expect(queue.waiting).toBe(4);
  });

  it("says how many messages wait, and how many more go out today", async () => {
    const campaign = await draft();
    // As the extension records a message it took up: campaign mail when its
    // batch let it out, anything else as soon as it was written.
    const sent = (key: string, iso: string) =>
      store.set(`mail/${key}`, {
        delivery: {
          state: "SUCCESS",
          startTime: new Timestamp(Date.parse(iso)),
        },
      });
    // Mailgun's day starts at midnight UTC: yesterday's does not count.
    sent("campaign_old_x", "2026-10-09T07:00:00Z");
    sent("campaign_old_y", "2026-10-09T11:59:00Z");
    sent("campaign_old_z", "2026-10-08T23:59:00Z");
    // Mail that is never held counts too: Mailgun's 100 a day cover
    // everything the site sends.
    sent("revisionApproved_r1", "2026-10-09T08:00:00Z");
    sent("newsletterConfirmation_n1", "2026-10-09T09:00:00Z");

    const { queue } = await queueCampaign(db, {
      campaign,
      members: [member("a", { admin: true }), member("b", { admin: true })],
      community: COMMUNITY,
      uids: ["a", "b"],
      by: "owner",
      siteUrl: "https://koryta.pl",
      now: NOW,
    });
    expect(queue).toEqual({ waiting: 2, leftToday: 86 });

    for (let i = 0; i < 86; i++) {
      sent(`revisionApproved_spent${i}`, "2026-10-09T10:00:00Z");
    }
    expect(await campaignQueue(db, NOW)).toEqual({ waiting: 2, leftToday: 0 });
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
    store.set(`mail/campaign_${campaign.id}_d`, {
      campaign: campaign.id,
      uid: "d",
      created_at: Timestamp.now(),
      delivery: { state: "HELD" },
    });
    store.set(`mail/campaign_${campaign.id}_e`, {
      campaign: campaign.id,
      uid: "e",
      created_at: Timestamp.now(),
      released_at: new Timestamp(Date.parse("2026-10-09T12:05:00Z")),
      delivery: { state: "PENDING" },
    });
    store.set(`mail/campaign_${campaign.id}_f`, {
      campaign: campaign.id,
      uid: "f",
      created_at: Timestamp.now(),
      delivery: {
        state: "WITHDRAWN",
        endTime: new Timestamp(Date.parse("2026-10-09T13:00:00Z")),
      },
      withdrawn_reason: "noConsent",
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
      // Waiting for its batch: nothing has picked it up either, and it has
      // not been handed over at all yet.
      d: {
        state: "queued",
        queuedAt: null,
        finishedAt: null,
        error: null,
      },
      // Handed over with its batch five minutes after the send.
      e: {
        state: "PENDING",
        queuedAt: "2026-10-09T12:05:00.000Z",
        finishedAt: null,
        error: null,
      },
      // Its reader left before its batch came: it never went.
      f: {
        state: "WITHDRAWN",
        queuedAt: null,
        finishedAt: "2026-10-09T13:00:00.000Z",
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
      // Kept with the topics, so /profil can say when and where they changed.
      newsletterUpdated: { via: "wypisz" },
    });
    expect(store.get(`mailCampaigns/${campaign.id}`)!.unsubscribed).toEqual([
      "a",
    ]);
  });

  it("withdraws the campaign mail they may no longer get that still waits for its batch, at once", async () => {
    const token = await mailToken(db, "a");
    store.set("users/a", {
      newsletter: { callsToAction: true, recentPeople: true },
    });
    const message = (key: string, uid: string, topic: string, state = "HELD") =>
      store.set(`mail/${key}`, {
        to: [`${uid}@example.com`],
        kind: "campaign",
        campaign: key,
        topic,
        uid,
        delivery: { state },
      });
    message("campaign_c1_a", "a", "callsToAction");
    // The other topic they still want.
    message("campaign_c2_a", "a", "recentPeople");
    // Let out already: on its way, or sent.
    message("campaign_c3_a", "a", "callsToAction", "PENDING");
    // Somebody else's.
    message("campaign_c1_b", "b", "callsToAction");

    expect(
      await unsubscribe(db, { uid: "a", token, topic: "callsToAction" }),
    ).toBe("unsubscribed");

    expect(store.get("mail/campaign_c1_a")).toMatchObject({
      delivery: { state: "WITHDRAWN" },
      withdrawn_reason: "noConsent",
    });
    expect(store.get("mail/campaign_c2_a")).toMatchObject({
      delivery: { state: "HELD" },
    });
    expect(store.get("mail/campaign_c3_a")).toMatchObject({
      delivery: { state: "PENDING" },
    });
    expect(store.get("mail/campaign_c1_b")).toMatchObject({
      delivery: { state: "HELD" },
    });
  });

  it("withdraws team mail too, since leaving takes them off it", async () => {
    const token = await mailToken(db, "admin");
    getUsers.mockResolvedValue({
      users: [
        {
          uid: "admin",
          email: "admin@example.com",
          emailVerified: true,
          disabled: false,
          customClaims: { admin: true },
        },
      ],
    });
    store.set("mail/campaign_c2_admin", {
      to: ["admin@example.com"],
      topic: "recentPeople",
      uid: "admin",
      delivery: { state: "HELD" },
    });

    await unsubscribe(db, { uid: "admin", token, topic: "callsToAction" });
    expect(store.get("mail/campaign_c2_admin")).toMatchObject({
      delivery: { state: "WITHDRAWN" },
      withdrawn_reason: "teamOptOut",
    });
  });

  it("still unsubscribes when the held mail cannot be withdrawn, which the release then does", async () => {
    const token = await mailToken(db, "a");
    store.set("mail/campaign_c1_a", {
      to: ["a@example.com"],
      topic: "callsToAction",
      uid: "a",
      delivery: { state: "HELD" },
    });
    getUsers.mockRejectedValue(new Error("auth service unavailable"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await unsubscribe(db, { uid: "a", token, topic: "callsToAction" }),
    ).toBe("unsubscribed");
    expect(store.get("users/a")).toMatchObject({
      newsletter: { callsToAction: false },
    });
    // Still held: the release asks again before it lets anything out.
    expect(store.get("mail/campaign_c1_a")).toMatchObject({
      delivery: { state: "HELD" },
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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

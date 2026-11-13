import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { releaseHeldMail } from "../../functions/src/mail";
import type { AccountRecord } from "../../shared/campaignConsent";

/** The options `releaseCampaignMail` is deployed with. */
const scheduled = vi.hoisted(() => ({ options: undefined as unknown }));

vi.mock("firebase-functions/v2/scheduler", () => ({
  // The handler itself; these tests call `releaseHeldMail` directly.
  onSchedule: (options: unknown, handler: unknown) => {
    scheduled.options = options;
    return handler;
  },
}));

vi.mock("firebase-functions/logger", () => ({ info: vi.fn() }));

type Data = Record<string, unknown>;

/** `mail`, by document id. Every write moves the document's update time on,
 * as in Firestore, the test's own writes included; a counter stands in for
 * the time. */
class Mail extends Map<string, Data> {
  readonly updateTimes = new Map<string, number>();
  private writes = 0;

  override set(id: string, data: Data): this {
    this.updateTimes.set(id, ++this.writes);
    return super.set(id, data);
  }
}

let mail: Mail;
/** `users/{uid}` and `newsletterSubscribers/{id}`, by id. */
let users: Map<string, Data>;
let subscribers: Map<string, Data>;
/** The auth service's accounts, by uid. */
let accounts: Map<string, AccountRecord>;

function at(data: Data, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data);
}

/** Enough of Firestore for the release: `mail` queried with `==`, or with `>=`
 * on a time, with `limit` and `count`, and a write batch of updates, each with
 * an optional `lastUpdateTime` precondition. A batch commits all or nothing.
 * `users` and `newsletterSubscribers` are read with `getAll`.
 *
 * `beforeCommit` holds a run back between its reads and its write, for a
 * second run to go in between. */
function fakeDb(beforeCommit?: () => Promise<void>): Firestore {
  type Filter = [string, string, unknown];
  const query = (filters: Filter[], limit = Infinity) => {
    const docs = () =>
      [...mail]
        .filter(([, data]) =>
          filters.every(([field, op, value]) =>
            op === ">="
              ? (at(data, field) as Date | undefined)?.getTime() !==
                  undefined &&
                (at(data, field) as Date).getTime() >= (value as Date).getTime()
              : at(data, field) === value,
          ),
        )
        .slice(0, limit)
        .map(([id, data]) => ({
          id,
          ref: { id },
          data: () => data,
          updateTime: mail.updateTimes.get(id),
        }));
    return {
      where: (field: string, op: string, value: unknown): unknown =>
        query([...filters, [field, op, value]], limit),
      limit: (n: number): unknown => query(filters, n),
      count: () => ({
        get: async () => ({ data: () => ({ count: docs().length }) }),
      }),
      get: async () => {
        const found = docs();
        return { empty: found.length === 0, size: found.length, docs: found };
      },
    };
  };
  const stores: Record<string, Map<string, Data>> = {
    users,
    newsletterSubscribers: subscribers,
  };
  type Ref = { id: string; store: Map<string, Data> };
  return {
    collection: (name: string) => {
      if (name === "mail") return query([]);
      const store = stores[name];
      expect(store, `collection ${name}`).toBeDefined();
      return { doc: (id: string): Ref => ({ id, store: store! }) };
    },
    // References, then the read options.
    getAll: async (...args: unknown[]) =>
      (args.filter((arg) => "store" in (arg as object)) as Ref[]).map(
        (ref) => ({ id: ref.id, data: () => ref.store.get(ref.id) }),
      ),
    batch: () => {
      type Precondition = { lastUpdateTime?: number };
      const updates: [string, Data, Precondition | undefined][] = [];
      return {
        update: (
          ref: { id: string },
          data: Data,
          precondition?: Precondition,
        ) => updates.push([ref.id, data, precondition]),
        commit: async () => {
          await beforeCommit?.();
          const stale = updates.find(
            ([id, , precondition]) =>
              precondition?.lastUpdateTime !== undefined &&
              precondition.lastUpdateTime !== mail.updateTimes.get(id),
          );
          if (stale) {
            // What firebase-admin throws: the gRPC status as a number.
            throw Object.assign(
              new Error(`9 FAILED_PRECONDITION: ${stale[0]} has changed`),
              { code: 9 },
            );
          }
          for (const [id, data] of updates) {
            mail.set(id, { ...mail.get(id), ...data });
          }
        },
      };
    },
  } as unknown as Firestore;
}

/** The auth service, as `getUsers` answers: the accounts found, by uid or by
 * address. */
const getUsers = vi.fn(
  async (identifiers: ({ uid: string } | { email: string })[]) => ({
    users: identifiers.flatMap((id) => {
      if ("email" in id) {
        return [...accounts.values()].filter((a) => a.email === id.email);
      }
      const account = accounts.get(id.uid);
      return account ? [account] : [];
    }),
  }),
);
const auth = { getUsers } as unknown as Auth;

const NOW = new Date("2026-11-13T12:00:00Z");
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000);

const release = (now: Date, on: Firestore = db) =>
  releaseHeldMail(on, auth, now);

/** Held messages of campaign `c` about "callsToAction", each to a reader who
 * switched that topic on, as a send leaves them. */
function hold(count: number, prefix = "held") {
  for (let i = 0; i < count; i++) {
    const uid = `${prefix}${String(i).padStart(2, "0")}`;
    accounts.set(uid, {
      uid,
      email: `${uid}@example.com`,
      emailVerified: true,
      disabled: false,
    });
    users.set(uid, { newsletter: { callsToAction: true } });
    mail.set(`campaign_c_${uid}`, {
      to: [`${uid}@example.com`],
      campaign: "c",
      topic: "callsToAction",
      uid,
      message: { subject: "Temat" },
      delivery: { state: "HELD" },
    });
  }
}

/** Messages an earlier run let out at `when`. */
function releasedAt(count: number, when: Date, prefix = "out") {
  for (let i = 0; i < count; i++) {
    mail.set(`campaign_c_${prefix}${i}`, {
      delivery: { state: "SUCCESS", startTime: when },
      released_at: when,
    });
  }
}

/** Mail that is never held - revision notifications here - which the
 * extension took up at `when`. */
function notifiedAt(count: number, when: Date, prefix = "note") {
  for (let i = 0; i < count; i++) {
    mail.set(`revisionApproved_${prefix}${i}`, {
      kind: "revisionApproved",
      message: { subject: "Zmiana" },
      delivery: { state: "SUCCESS", startTime: when },
    });
  }
}

const states = () =>
  [...mail.values()].map((data) => at(data, "delivery.state"));

let db: Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  mail = new Mail();
  users = new Map();
  subscribers = new Map();
  accounts = new Map();
  db = fakeDb();
});

describe("releaseHeldMail", () => {
  it("lets out one batch of held messages, the way the extension starts a delivery", async () => {
    hold(25);

    expect(await release(NOW)).toEqual({ released: 20, withdrawn: [] });

    expect(states().filter((s) => s === "PENDING")).toHaveLength(20);
    expect(states().filter((s) => s === "HELD")).toHaveLength(5);
    const released = [...mail.values()].find(
      (data) => at(data, "delivery.state") === "PENDING",
    )!;
    expect(released).toMatchObject({
      message: { subject: "Temat" },
      delivery: { startTime: NOW, state: "PENDING", attempts: 0, error: null },
      released_at: NOW,
    });
  });

  it("waits out the gap after a batch before the next", async () => {
    hold(25);
    await release(NOW);

    // A run half a minute later - by hand, or a retry - sends nothing.
    expect((await release(seconds(30))).released).toBe(0);
    // The next minute's run sends the rest.
    expect((await release(seconds(60))).released).toBe(5);
    expect(states().filter((s) => s === "HELD")).toHaveLength(0);
  });

  it("fills a batch only up to what went out within the gap", async () => {
    releasedAt(15, seconds(-20));
    hold(10);

    expect((await release(NOW)).released).toBe(5);
  });

  it("stops at the day's allowance, counted from midnight UTC", async () => {
    releasedAt(85, new Date("2026-11-13T08:00:00Z"));
    // Yesterday's do not count.
    releasedAt(40, new Date("2026-11-12T23:59:00Z"), "yesterday");
    hold(20);

    expect((await release(NOW)).released).toBe(5);
    expect((await release(seconds(120))).released).toBe(0);
    // The rest go out after midnight.
    expect((await release(new Date("2026-11-14T00:00:30Z"))).released).toBe(15);
  });

  it("counts every message the site sent today toward the day, not only campaign mail", async () => {
    // Mailgun's 100 a day cover notifications, newsletter confirmations and
    // test mails too.
    notifiedAt(80, new Date("2026-11-13T09:00:00Z"));
    releasedAt(5, new Date("2026-11-13T10:00:00Z"));
    notifiedAt(30, new Date("2026-11-12T20:00:00Z"), "yesterday");
    hold(20);

    expect((await release(NOW)).released).toBe(5);
    expect((await release(seconds(120))).released).toBe(0);
  });

  it("leaves room in a batch for other mail that just went out", async () => {
    notifiedAt(15, seconds(-20));
    hold(20);

    expect((await release(NOW)).released).toBe(5);
  });

  it("leaves every other message alone", async () => {
    mail.set("campaign_c_failed", { delivery: { state: "ERROR" } });
    mail.set("campaign_c_sent", { delivery: { state: "SUCCESS" } });
    mail.set("campaign_c_gone", { delivery: { state: "WITHDRAWN" } });
    mail.set("revisionApproved_r1", { message: { subject: "Zmiana" } });

    expect(await release(NOW)).toEqual({ released: 0, withdrawn: [] });
    expect(states()).toEqual(["ERROR", "SUCCESS", "WITHDRAWN", undefined]);
    expect(mail.get("revisionApproved_r1")).not.toHaveProperty("released_at");
  });

  it("asks again before a message goes, and withdraws it if its reader left the topic since", async () => {
    hold(3);
    // Unsubscribed while the message waited: /profil, or another
    // campaign's link.
    users.set("held01", {
      newsletter: { callsToAction: false, recentPeople: true },
    });

    expect(await release(NOW)).toEqual({
      released: 2,
      withdrawn: [{ id: "campaign_c_held01", reason: "noConsent" }],
    });
    const withdrawn = mail.get("campaign_c_held01")!;
    expect(withdrawn).toMatchObject({
      delivery: { state: "WITHDRAWN", endTime: NOW },
      withdrawn_reason: "noConsent",
    });
    // Never handed over, so nothing counts it as sent.
    expect(withdrawn).not.toHaveProperty("released_at");
    expect(withdrawn).not.toHaveProperty("delivery.startTime");

    // And no later run picks it up, even after the reader comes back.
    users.set("held01", { newsletter: { callsToAction: true } });
    expect(await release(seconds(60))).toEqual({ released: 0, withdrawn: [] });
    expect(mail.get("campaign_c_held01")).toMatchObject({
      delivery: { state: "WITHDRAWN" },
    });
  });

  it("counts a withdrawn message toward neither the batch nor the day", async () => {
    releasedAt(85, new Date("2026-11-13T08:00:00Z"));
    hold(10);
    users.set("held00", {});
    users.set("held01", {});

    // Room for 5 today: 2 of them may no longer be written to.
    expect(await release(NOW)).toEqual({
      released: 3,
      withdrawn: [
        { id: "campaign_c_held00", reason: "noConsent" },
        { id: "campaign_c_held01", reason: "noConsent" },
      ],
    });
    // 88 went today, so 2 more may.
    expect((await release(seconds(120))).released).toBe(2);
  });

  it("withdraws a message whose account was disabled, deleted, unverified, or moved to another address", async () => {
    hold(5);
    accounts.set("held00", { ...accounts.get("held00")!, disabled: true });
    accounts.delete("held01");
    accounts.set("held02", {
      ...accounts.get("held02")!,
      emailVerified: false,
    });
    accounts.set("held03", {
      ...accounts.get("held03")!,
      email: "nowy@example.com",
    });
    // The address as it was, in other letters, is still the address.
    accounts.set("held04", {
      ...accounts.get("held04")!,
      email: "HELD04@Example.com",
    });

    expect(await release(NOW)).toEqual({
      released: 1,
      withdrawn: [
        { id: "campaign_c_held00", reason: "disabled" },
        { id: "campaign_c_held01", reason: "unknown" },
        { id: "campaign_c_held02", reason: "unverified" },
        { id: "campaign_c_held03", reason: "addressChanged" },
      ],
    });
    expect(mail.get("campaign_c_held04")).toMatchObject({
      delivery: { state: "PENDING" },
    });
  });

  it("withdraws team mail from somebody no longer on the team, or who turned it off", async () => {
    hold(3);
    for (const uid of ["held00", "held01", "held02"]) {
      users.set(uid, {});
      accounts.set(uid, {
        ...accounts.get(uid)!,
        customClaims: { admin: true },
      });
    }
    users.set("held01", { teamMail: false });
    accounts.set("held02", { ...accounts.get("held02")!, customClaims: {} });

    expect(await release(NOW)).toEqual({
      released: 1,
      withdrawn: [
        { id: "campaign_c_held01", reason: "teamOptOut" },
        { id: "campaign_c_held02", reason: "noConsent" },
      ],
    });
  });

  it("asks the same of readers without an account", async () => {
    const subscriber = (id: string, data: Data) => {
      subscribers.set(id, data);
      mail.set(`campaign_c_sub_${id}`, {
        to: [`${id}@example.com`],
        campaign: "c",
        topic: "callsToAction",
        uid: `sub_${id}`,
        delivery: { state: "HELD" },
      });
    };
    const confirmed = (id: string) => ({
      email: `${id}@example.com`,
      status: "confirmed",
      topics: { callsToAction: true, recentPeople: true },
    });
    subscriber("still", confirmed("still"));
    subscriber("left", {
      ...confirmed("left"),
      topics: { callsToAction: false, recentPeople: true },
    });
    subscriber("gone", {
      ...confirmed("gone"),
      status: "unsubscribed",
      topics: { callsToAction: false, recentPeople: false },
    });
    // Has an account under the same address since: the account answers for
    // it, and has not switched the topic on.
    subscriber("joined", confirmed("joined"));
    accounts.set("joined-uid", {
      uid: "joined-uid",
      email: "joined@example.com",
      emailVerified: true,
      disabled: false,
    });

    expect(await release(NOW)).toEqual({
      released: 1,
      withdrawn: [
        { id: "campaign_c_sub_left", reason: "noConsent" },
        { id: "campaign_c_sub_gone", reason: "unknown" },
        { id: "campaign_c_sub_joined", reason: "unknown" },
      ],
    });
    expect(mail.get("campaign_c_sub_still")).toMatchObject({
      delivery: { state: "PENDING" },
    });
  });

  it("asks nobody anything while the day has no room", async () => {
    releasedAt(90, new Date("2026-11-13T08:00:00Z"));
    hold(5);

    expect(await release(NOW)).toEqual({ released: 0, withdrawn: [] });
    expect(getUsers).not.toHaveBeenCalled();
  });

  it("sends nothing from a run that read its messages before another run let them out", async () => {
    hold(2);
    const sent = "campaign_c_held00";
    const waiting = "campaign_c_held01";

    // One run reads both messages held, and is held back before it writes...
    let reachedCommit!: () => void;
    let resume!: () => void;
    const atCommit = new Promise<void>((resolve) => (reachedCommit = resolve));
    const late = release(
      NOW,
      fakeDb(() => {
        reachedCommit();
        return new Promise((resolve) => (resume = resolve));
      }),
    );
    await atCommit;
    // ...while the other lets them out, and the extension sends one.
    expect((await release(seconds(1))).released).toBe(2);
    mail.set(sent, { ...mail.get(sent), delivery: { state: "SUCCESS" } });
    resume();

    // Its write would set both PENDING again, and the extension would send
    // each of them a second time.
    expect(await late).toEqual({ released: 0, withdrawn: [] });
    expect(mail.get(sent)).toMatchObject({
      delivery: { state: "SUCCESS" },
      released_at: seconds(1),
    });
    expect(mail.get(waiting)).toMatchObject({
      delivery: { state: "PENDING", startTime: seconds(1) },
      released_at: seconds(1),
    });
  });

  it("sends nothing from a run that read a message before its reader unsubscribed", async () => {
    hold(2);
    let reachedCommit!: () => void;
    let resume!: () => void;
    const atCommit = new Promise<void>((resolve) => (reachedCommit = resolve));
    // The run finds both readers still subscribed...
    const late = release(
      NOW,
      fakeDb(() => {
        reachedCommit();
        return new Promise((resolve) => (resume = resolve));
      }),
    );
    await atCommit;
    // ...and one of them leaves before it writes, which withdraws their
    // message on the spot (server/utils/heldMail.ts).
    users.set("held00", { newsletter: { callsToAction: false } });
    mail.set("campaign_c_held00", {
      ...mail.get("campaign_c_held00"),
      delivery: { state: "WITHDRAWN", endTime: NOW },
      withdrawn_reason: "noConsent",
    });
    resume();

    expect(await late).toEqual({ released: 0, withdrawn: [] });
    expect(mail.get("campaign_c_held00")).toMatchObject({
      delivery: { state: "WITHDRAWN" },
    });
    // The next run reads afresh, and sends only the other one.
    expect(await release(seconds(60))).toEqual({ released: 1, withdrawn: [] });
    expect(mail.get("campaign_c_held01")).toMatchObject({
      delivery: { state: "PENDING" },
    });
  });
});

describe("releaseCampaignMail", () => {
  it("runs one at a time: one instance, taking one request", () => {
    // A 2nd gen function takes 80 requests at once on an instance unless
    // told otherwise, so one instance alone still lets two runs overlap.
    expect(scheduled.options).toMatchObject({
      maxInstances: 1,
      concurrency: 1,
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { releaseHeldMail } from "../../functions/src/mail";

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

function at(data: Data, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data);
}

/** Enough of Firestore for the release: `mail` queried with `==`, or with `>=`
 * on a time, with `limit` and `count`, and a write batch of updates, each with
 * an optional `lastUpdateTime` precondition. A batch commits all or nothing.
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
  return {
    collection: (name: string) => {
      expect(name).toBe("mail");
      return query([]);
    },
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

const NOW = new Date("2026-11-13T12:00:00Z");
const seconds = (n: number) => new Date(NOW.getTime() + n * 1000);

function hold(count: number, prefix = "held") {
  for (let i = 0; i < count; i++) {
    mail.set(`campaign_c_${prefix}${String(i).padStart(2, "0")}`, {
      campaign: "c",
      message: { subject: "Temat" },
      delivery: { state: "HELD" },
    });
  }
}

/** Messages an earlier run let out at `when`. */
function releasedAt(count: number, when: Date, prefix = "out") {
  for (let i = 0; i < count; i++) {
    mail.set(`campaign_c_${prefix}${i}`, {
      delivery: { state: "SUCCESS" },
      released_at: when,
    });
  }
}

const states = () =>
  [...mail.values()].map((data) => at(data, "delivery.state"));

let db: Firestore;

beforeEach(() => {
  mail = new Mail();
  db = fakeDb();
});

describe("releaseHeldMail", () => {
  it("lets out one batch of held messages, the way the extension starts a delivery", async () => {
    hold(25);

    expect(await releaseHeldMail(db, NOW)).toBe(20);

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
    await releaseHeldMail(db, NOW);

    // A run half a minute later - by hand, or a retry - sends nothing.
    expect(await releaseHeldMail(db, seconds(30))).toBe(0);
    // The next minute's run sends the rest.
    expect(await releaseHeldMail(db, seconds(60))).toBe(5);
    expect(states().filter((s) => s === "HELD")).toHaveLength(0);
  });

  it("fills a batch only up to what went out within the gap", async () => {
    releasedAt(15, seconds(-20));
    hold(10);

    expect(await releaseHeldMail(db, NOW)).toBe(5);
  });

  it("stops at the day's allowance, counted from midnight UTC", async () => {
    releasedAt(85, new Date("2026-11-13T08:00:00Z"));
    // Yesterday's do not count.
    releasedAt(40, new Date("2026-11-12T23:59:00Z"), "yesterday");
    hold(20);

    expect(await releaseHeldMail(db, NOW)).toBe(5);
    expect(await releaseHeldMail(db, seconds(120))).toBe(0);
    // The rest go out after midnight.
    expect(await releaseHeldMail(db, new Date("2026-11-14T00:00:30Z"))).toBe(
      15,
    );
  });

  it("leaves every other message alone", async () => {
    mail.set("campaign_c_failed", { delivery: { state: "ERROR" } });
    mail.set("campaign_c_sent", { delivery: { state: "SUCCESS" } });
    mail.set("revisionApproved_r1", { message: { subject: "Zmiana" } });

    expect(await releaseHeldMail(db, NOW)).toBe(0);
    expect(states()).toEqual(["ERROR", "SUCCESS", undefined]);
    expect(mail.get("revisionApproved_r1")).not.toHaveProperty("released_at");
  });

  it("sends nothing from a run that read its messages before another run let them out", async () => {
    hold(2);
    const sent = "campaign_c_held00";
    const waiting = "campaign_c_held01";

    // One run reads both messages held, and is held back before it writes...
    let reachedCommit!: () => void;
    let resume!: () => void;
    const atCommit = new Promise<void>((resolve) => (reachedCommit = resolve));
    const late = releaseHeldMail(
      fakeDb(() => {
        reachedCommit();
        return new Promise((resolve) => (resume = resolve));
      }),
      NOW,
    );
    await atCommit;
    // ...while the other lets them out, and the extension sends one.
    expect(await releaseHeldMail(db, seconds(1))).toBe(2);
    mail.set(sent, { ...mail.get(sent), delivery: { state: "SUCCESS" } });
    resume();

    // Its write would set both PENDING again, and the extension would send
    // each of them a second time.
    expect(await late).toBe(0);
    expect(mail.get(sent)).toMatchObject({
      delivery: { state: "SUCCESS" },
      released_at: seconds(1),
    });
    expect(mail.get(waiting)).toMatchObject({
      delivery: { state: "PENDING", startTime: seconds(1) },
      released_at: seconds(1),
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

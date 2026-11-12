import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { releaseHeldMail } from "../../functions/src/mail";

vi.mock("firebase-functions/v2/scheduler", () => ({
  // The handler itself; these tests call `releaseHeldMail` directly.
  onSchedule: (_options: unknown, handler: unknown) => handler,
}));

vi.mock("firebase-functions/logger", () => ({ info: vi.fn() }));

type Data = Record<string, unknown>;

/** `mail`, by document id. */
let mail: Map<string, Data>;

function at(data: Data, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, key) => (value as Data | undefined)?.[key], data);
}

/** Enough of Firestore for the release: `mail` queried with `==`, or with `>=`
 * on a time, with `limit` and `count`, and a write batch of updates. */
function fakeDb(): Firestore {
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
        .map(([id, data]) => ({ id, ref: { id }, data: () => data }));
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
      const updates: [string, Data][] = [];
      return {
        update: (ref: { id: string }, data: Data) =>
          updates.push([ref.id, data]),
        commit: async () => {
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
  mail = new Map();
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
});

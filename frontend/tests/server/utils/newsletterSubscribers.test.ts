import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  DAILY_CONFIRMATIONS_CAP,
  confirmSubscription,
  confirmedSubscribers,
  requestSubscription,
  subscriberId,
} from "../../../server/utils/newsletterSubscribers";
import { unsubscribe } from "../../../server/utils/mailTokens";

const { store, FieldValue, Timestamp } = vi.hoisted(() => {
  class Timestamp {
    constructor(readonly millis: number) {}
    static now() {
      return new Timestamp(Date.parse("2026-10-17T12:00:00Z"));
    }
    static fromDate(date: Date) {
      return new Timestamp(date.getTime());
    }
    static fromMillis(millis: number) {
      return new Timestamp(millis);
    }
    toDate() {
      return new Date(this.millis);
    }
    toMillis() {
      return this.millis;
    }
  }
  const DELETE = { delete: true };
  return {
    Timestamp,
    /** Every document, by `collection/id`. */
    store: new Map<string, Record<string, unknown>>(),
    FieldValue: {
      delete: () => DELETE,
      arrayUnion: (...items: unknown[]) => ({ arrayUnion: items }),
    },
  };
});

vi.mock("firebase-admin/firestore", () => ({ FieldValue, Timestamp }));

/** Enough of Firestore for the subscriber store: get, set (with merge),
 * update (with delete), add, an equality query with a limit, and transactions
 * that run their reads and writes straight through - the tests run one at a
 * time, so there is nothing for a transaction to protect against here. */
function fakeDb(): Firestore {
  let added = 0;
  const docRef = (collection: string, id: string) => {
    const key = `${collection}/${id}`;
    return {
      id,
      get: async () => ({
        id,
        exists: store.has(key),
        data: () => store.get(key),
        get: (field: string) => store.get(key)?.[field],
      }),
      create: async (data: Record<string, unknown>) => {
        if (store.has(key)) {
          throw Object.assign(new Error("exists"), { code: 6 });
        }
        store.set(key, data);
      },
      set: async (
        data: Record<string, unknown>,
        options?: { merge?: boolean },
      ) => {
        store.set(key, options?.merge ? { ...store.get(key), ...data } : data);
      },
      update: async (data: Record<string, unknown>) => {
        const current = store.get(key);
        if (!current) throw Object.assign(new Error("missing"), { code: 5 });
        const merged = { ...current, ...data };
        store.set(
          key,
          Object.fromEntries(
            Object.entries(merged).filter(
              ([, value]) => value !== FieldValue.delete(),
            ),
          ),
        );
      },
    };
  };
  const query = (
    collection: string,
    filters: [string, unknown][],
    limit = Infinity,
  ) => ({
    where: (field: string, _op: string, value: unknown) =>
      query(collection, [...filters, [field, value]], limit),
    limit: (n: number) => query(collection, filters, n),
    get: async () => ({
      docs: [...store]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
        .slice(0, limit)
        .map(([key, data]) => ({
          id: key.slice(collection.length + 1),
          ref: docRef(collection, key.slice(collection.length + 1)),
          data: () => data,
        })),
    }),
  });
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => docRef(collection, id),
      add: async (data: Record<string, unknown>) => {
        const id = `added${++added}`;
        store.set(`${collection}/${id}`, data);
        return docRef(collection, id);
      },
      ...query(collection, []),
    }),
    runTransaction: async <T>(
      body: (tx: {
        get: (ref: ReturnType<typeof docRef>) => unknown;
        set: (
          ref: ReturnType<typeof docRef>,
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => void;
        update: (
          ref: ReturnType<typeof docRef>,
          data: Record<string, unknown>,
        ) => void;
      }) => Promise<T>,
    ): Promise<T> => {
      const writes: (() => Promise<void>)[] = [];
      const result = await body({
        get: (ref) => ref.get(),
        set: (ref, data, options) => writes.push(() => ref.set(data, options)),
        update: (ref, data) => writes.push(() => ref.update(data)),
      });
      for (const write of writes) await write();
      return result;
    },
  };
  return db as unknown as Firestore;
}

const SITE = "https://koryta.pl";
const NOW = new Date("2026-10-17T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: Firestore;
beforeEach(() => {
  store.clear();
  db = fakeDb();
});

const mails = () =>
  [...store].filter(([key]) => key.startsWith("mail/")).map(([, data]) => data);

async function ask(email: string, now = NOW) {
  return requestSubscription(db, {
    email,
    where: "home",
    siteUrl: SITE,
    now,
  });
}

describe("requestSubscription", () => {
  it("keeps a new address as pending and mails it the confirmation link", async () => {
    expect(await ask("anna@example.com")).toBe("sent");

    const id = subscriberId("anna@example.com");
    const subscriber = store.get(`newsletterSubscribers/${id}`)!;
    expect(subscriber).toMatchObject({
      email: "anna@example.com",
      status: "pending",
      topics: { callsToAction: true, recentPeople: true },
      where: "home",
    });
    expect(
      (subscriber.expireAt as InstanceType<typeof Timestamp>).toMillis(),
    ).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [mail] = mails();
    expect(mail).toMatchObject({
      to: ["anna@example.com"],
      kind: "newsletterConfirmation",
      subscriber: id,
    });
    const token = store.get(`mailTokens/sub_${id}`)!.token as string;
    expect((mail!.message as { text: string }).text).toContain(
      `${SITE}/newsletter/potwierdz?s=${id}&t=${encodeURIComponent(token)}`,
    );
  });

  it("sends one address its link at most every ten minutes, and three times a day", async () => {
    expect(await ask("anna@example.com")).toBe("sent");
    expect(await ask("anna@example.com", minutes(5))).toBe("throttled");
    expect(await ask("anna@example.com", minutes(11))).toBe("sent");
    expect(await ask("anna@example.com", minutes(22))).toBe("sent");
    expect(await ask("anna@example.com", minutes(40))).toBe("throttled");
    // A day after the first, the oldest no longer counts.
    expect(await ask("anna@example.com", minutes(24 * 60 + 1))).toBe("sent");
    expect(mails()).toHaveLength(4);
  });

  it("sends nothing to an address already confirmed", async () => {
    store.set(`newsletterSubscribers/${subscriberId("anna@example.com")}`, {
      email: "anna@example.com",
      status: "confirmed",
    });
    expect(await ask("anna@example.com")).toBe("alreadyConfirmed");
    expect(mails()).toHaveLength(0);
  });

  it("stops at the day's cap, whatever the address", async () => {
    store.set("newsletterLimits/2026-10-17", {
      count: DAILY_CONFIRMATIONS_CAP,
    });
    expect(await ask("anna@example.com")).toBe("capped");
    expect(mails()).toHaveLength(0);
    expect(
      store.has(`newsletterSubscribers/${subscriberId("anna@example.com")}`),
    ).toBe(false);
  });
});

describe("confirmSubscription", () => {
  async function pending() {
    await ask("anna@example.com");
    const id = subscriberId("anna@example.com");
    const token = store.get(`mailTokens/sub_${id}`)!.token as string;
    return { id, token };
  }

  it("confirms with the link's token, once", async () => {
    const { id, token } = await pending();
    expect(await confirmSubscription(db, { id, token, now: minutes(5) })).toBe(
      "confirmed",
    );
    const subscriber = store.get(`newsletterSubscribers/${id}`)!;
    expect(subscriber.status).toBe("confirmed");
    expect(subscriber).not.toHaveProperty("expireAt");
    expect(await confirmSubscription(db, { id, token, now: minutes(6) })).toBe(
      "alreadyConfirmed",
    );
    expect((await confirmedSubscribers(db)).map((s) => s.email)).toEqual([
      "anna@example.com",
    ]);
  });

  it("refuses a wrong token, an expired link and a withdrawn request", async () => {
    const { id, token } = await pending();
    expect(
      await confirmSubscription(db, { id, token: "zly", now: minutes(5) }),
    ).toBe("invalid");
    expect(
      await confirmSubscription(db, { id, token, now: minutes(8 * 24 * 60) }),
    ).toBe("invalid");
    store.set(`newsletterSubscribers/${id}`, {
      ...store.get(`newsletterSubscribers/${id}`),
      status: "unsubscribed",
    });
    expect(await confirmSubscription(db, { id, token, now: minutes(5) })).toBe(
      "invalid",
    );
    expect(await confirmedSubscribers(db)).toEqual([]);
  });
});

describe("unsubscribing a subscriber", () => {
  it("takes the topic off, and the address off the list with the last one", async () => {
    await ask("anna@example.com");
    const id = subscriberId("anna@example.com");
    const token = store.get(`mailTokens/sub_${id}`)!.token as string;
    await confirmSubscription(db, { id, token, now: minutes(5) });

    expect(
      await unsubscribe(db, {
        uid: `sub_${id}`,
        token,
        topic: "callsToAction",
      }),
    ).toBe("unsubscribed");
    expect(store.get(`newsletterSubscribers/${id}`)).toMatchObject({
      status: "confirmed",
      topics: { callsToAction: false, recentPeople: true },
    });

    await unsubscribe(db, { uid: `sub_${id}`, token, topic: "recentPeople" });
    expect(store.get(`newsletterSubscribers/${id}`)!.status).toBe(
      "unsubscribed",
    );
    // Nothing of the subscriber's lands in `users`.
    expect([...store.keys()].some((key) => key.startsWith("users/"))).toBe(
      false,
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  CONFIRM_REMINDER_BATCH,
  CONFIRMATION_GAP_MS,
  confirmReminderRecipients,
  queueAddressConfirmation,
  queueConfirmReminders,
  type ConfirmReminderRecipient,
} from "../../../server/utils/confirmAddress";
import { emptyActivityCounts } from "../../../shared/activity";
import type { AudienceMember } from "../../../shared/campaigns";

const { store, mockLink, Timestamp } = vi.hoisted(() => {
  const stamp = (millis: number) => ({ toMillis: () => millis });
  return {
    Timestamp: {
      now: () => stamp(0),
      fromDate: (date: Date) => stamp(date.getTime()),
    },
    /** Every `mail` document, by id. */
    store: new Map<string, Record<string, unknown>>(),
    mockLink: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({ Timestamp }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ generateEmailVerificationLink: mockLink }),
}));

const docRef = (id: string) => ({
  id,
  create: async (data: Record<string, unknown>) => {
    if (store.has(id)) throw Object.assign(new Error("exists"), { code: 6 });
    store.set(id, data);
  },
});

const db = {
  collection: () => ({ doc: docRef }),
  getAll: async (...refs: { id: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: store.has(ref.id),
      get: (field: string) => store.get(ref.id)?.[field],
    })),
} as unknown as Firestore;

function member(uid: string, overrides: Partial<AudienceMember> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: false,
    disabled: false,
    displayName: null,
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    lastSignInAt: null,
    lastSeenAt: "2026-11-20T10:00:00.000Z",
    activity: { counts: emptyActivityCounts(), total: 0 },
    preferences: { newsletter: { callsToAction: true, recentPeople: true } },
    ...overrides,
  } satisfies AudienceMember;
}

function recipient(uid: string): ConfirmReminderRecipient {
  return {
    uid,
    email: `${uid}@example.com`,
    reasons: ["newsletter"],
    createdAt: null,
    lastSeenAt: null,
    reminded: false,
  };
}

const SITE = "https://koryta.pl";

beforeEach(() => {
  store.clear();
  mockLink.mockReset();
  mockLink.mockImplementation(
    async (email: string) =>
      `https://koryta-pl.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=${email}&lang=en`,
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("confirmReminderRecipients", () => {
  it("takes the accounts waiting on their address, and marks who was reminded", async () => {
    store.set("confirmReminder_b", { to: ["b@example.com"] });
    const recipients = await confirmReminderRecipients(db, [
      member("a"),
      member("b"),
      member("confirmed", { emailVerified: true }),
      member("said-no", {
        preferences: { newsletter: { callsToAction: false } },
      }),
    ]);
    expect(recipients).toEqual([
      {
        uid: "a",
        email: "a@example.com",
        reasons: ["newsletter"],
        createdAt: "2026-11-01T10:00:00.000Z",
        lastSeenAt: "2026-11-20T10:00:00.000Z",
        reminded: false,
      },
      expect.objectContaining({ uid: "b", reminded: true }),
    ]);
  });

  it("reads nothing when nobody waits", async () => {
    const getAll = vi.spyOn(db, "getAll");
    expect(
      await confirmReminderRecipients(db, [
        member("x", { emailVerified: true }),
      ]),
    ).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });
});

describe("queueConfirmReminders", () => {
  it("queues the reminder with a Polish confirmation link back to /profil", async () => {
    const outcomes = await queueConfirmReminders(db, [recipient("a")], {
      siteUrl: SITE,
    });
    expect(outcomes).toEqual({ a: "queued" });
    expect(mockLink).toHaveBeenCalledWith("a@example.com", {
      url: "https://koryta.pl/profil",
    });
    const doc = store.get("confirmReminder_a")!;
    expect(doc).toMatchObject({
      to: ["a@example.com"],
      kind: "confirmReminder",
      uid: "a",
      reasons: ["newsletter"],
    });
    const message = doc.message as { subject: string; text: string };
    expect(message.subject).toBe("Potwierdź adres e-mail na koryta.pl");
    expect(message.text).toContain("oobCode=a%40example.com&lang=pl");
    expect(message.text).not.toContain("lang=en");
  });

  it("sends each account one reminder, ever", async () => {
    await queueConfirmReminders(db, [recipient("a")], { siteUrl: SITE });
    expect(
      await queueConfirmReminders(db, [recipient("a")], { siteUrl: SITE }),
    ).toEqual({ a: "duplicate" });
    expect(
      await queueConfirmReminders(db, [{ ...recipient("a"), reminded: true }], {
        siteUrl: SITE,
      }),
    ).toEqual({});
  });

  it("queues at most a batch, so a second call sends the rest", async () => {
    const many = Array.from({ length: CONFIRM_REMINDER_BATCH + 3 }, (_, i) =>
      recipient(`u${i}`),
    );
    const first = await queueConfirmReminders(db, many, { siteUrl: SITE });
    expect(Object.keys(first)).toHaveLength(CONFIRM_REMINDER_BATCH);
    const second = await queueConfirmReminders(
      db,
      many.map((r) => ({
        ...r,
        reminded: store.has(`confirmReminder_${r.uid}`),
      })),
      { siteUrl: SITE },
    );
    expect(Object.keys(second)).toHaveLength(3);
  });

  it("goes without the way back where Firebase does not know the site", async () => {
    mockLink.mockImplementationOnce(async () => {
      throw Object.assign(new Error("domain"), {
        code: "auth/unauthorized-continue-uri",
      });
    });
    expect(
      await queueConfirmReminders(db, [recipient("a")], { siteUrl: SITE }),
    ).toEqual({ a: "queued" });
    expect(mockLink).toHaveBeenLastCalledWith("a@example.com");
  });

  it("carries on past an account whose link cannot be made", async () => {
    mockLink.mockImplementationOnce(async () => {
      throw Object.assign(new Error("gone"), { code: "auth/user-not-found" });
    });
    expect(
      await queueConfirmReminders(db, [recipient("a"), recipient("b")], {
        siteUrl: SITE,
      }),
    ).toEqual({ a: "failed", b: "queued" });
    expect(store.has("confirmReminder_a")).toBe(false);
  });
});

describe("queueAddressConfirmation", () => {
  const NOW = new Date("2026-11-25T12:00:00Z");
  const account = { uid: "a", email: "a@example.com", emailVerified: false };
  const ask = (now = NOW, who = account) =>
    queueAddressConfirmation(db, who, { siteUrl: SITE, now });

  it("queues the confirmation in the day's first slot", async () => {
    expect(await ask()).toBe("queued");
    const doc = store.get("confirmAddress_a_2026-11-25_1")!;
    expect(doc).toMatchObject({
      to: ["a@example.com"],
      kind: "confirmAddress",
      uid: "a",
    });
    const message = doc.message as { subject: string; text: string };
    expect(message.subject).toBe("Potwierdź adres e-mail na koryta.pl");
    expect(message.text).toContain("Potwierdź adres e-mail swojego konta");
    expect(message.text).toContain("lang=pl");
    expect(message.text).not.toContain("To jedyne przypomnienie");
    expect(mockLink).toHaveBeenCalledWith("a@example.com", {
      url: "https://koryta.pl/profil",
    });
  });

  it("sends nothing to a confirmed account or one without an address", async () => {
    expect(await ask(NOW, { ...account, emailVerified: true })).toBe(
      "confirmed",
    );
    expect(await ask(NOW, { ...account, email: null })).toBe("noAddress");
    expect(store.size).toBe(0);
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("waits a minute between two, and stops at three a day", async () => {
    expect(await ask()).toBe("queued");
    expect(await ask(new Date(NOW.getTime() + 1_000))).toBe("tooSoon");

    const later = (minutes: number) =>
      new Date(NOW.getTime() + minutes * CONFIRMATION_GAP_MS);
    expect(await ask(later(1))).toBe("queued");
    expect(await ask(later(2))).toBe("queued");
    expect(await ask(later(3))).toBe("dailyLimit");
    expect(store.has("confirmAddress_a_2026-11-25_3")).toBe(true);

    // A new UTC day starts the count again.
    expect(await ask(new Date("2026-11-26T00:00:30Z"))).toBe("queued");
    expect(store.has("confirmAddress_a_2026-11-26_1")).toBe(true);
  });

  it("counts a slot another request took in the meantime as too soon", async () => {
    mockLink.mockImplementationOnce(async (email: string) => {
      store.set("confirmAddress_a_2026-11-25_1", { uid: "a" });
      return `https://koryta-pl.firebaseapp.com/__/auth/action?oobCode=${email}`;
    });
    expect(await ask()).toBe("tooSoon");
  });
});

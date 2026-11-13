import { describe, it, expect, vi } from "vitest";
import {
  accountConsent,
  confirmedSubscriber,
  heldMailVerdict,
  loadConsent,
  mailPreferences,
  withdrawal,
  type AccountRecord,
  type Consent,
  type ConsentReads,
} from "../../shared/campaignConsent";

type Data = Record<string, unknown>;

function account(uid: string, overrides: Partial<AccountRecord> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    disabled: false,
    ...overrides,
  };
}

/** The auth service and Firestore as the check reads them, over plain maps;
 * every call is recorded. */
function reads(
  accounts: AccountRecord[],
  docs: Record<string, Data>,
): ConsentReads & {
  getUsers: ReturnType<typeof vi.fn>;
  getAll: ReturnType<typeof vi.fn>;
} {
  type Ref = { path: string; id: string };
  const getUsers = vi.fn(
    async (identifiers: ({ uid: string } | { email: string })[]) => ({
      users: identifiers.flatMap((id) =>
        accounts.filter((a) =>
          "uid" in id ? a.uid === id.uid : a.email === id.email,
        ),
      ),
    }),
  );
  const getAll = vi.fn(async (...args: unknown[]) =>
    (args.filter((arg) => (arg as Ref).path) as Ref[]).map((ref) => ({
      id: ref.id,
      data: () => docs[ref.path],
    })),
  );
  return {
    db: {
      collection: (name: string) => ({
        doc: (id: string): Ref => ({ path: `${name}/${id}`, id }),
      }),
      getAll,
    },
    auth: { getUsers },
    getUsers,
    getAll,
  };
}

const consent = (overrides: Partial<Consent> = {}): Consent => ({
  email: "anna@example.com",
  emailVerified: true,
  disabled: false,
  admin: false,
  preferences: { newsletter: { callsToAction: true } },
  ...overrides,
});

const message = (overrides: Data = {}): Data => ({
  to: ["anna@example.com"],
  topic: "callsToAction",
  uid: "anna",
  delivery: { state: "HELD" },
  ...overrides,
});

describe("heldMailVerdict", () => {
  it("lets a message go to a reader who may still be written to about its topic", () => {
    expect(heldMailVerdict(message(), consent())).toEqual({ send: true });
    // On the team's grounds as well.
    expect(
      heldMailVerdict(message(), consent({ admin: true, preferences: {} })),
    ).toEqual({ send: true });
  });

  it("gives the reason a send would give for not writing to them", () => {
    const left = consent({
      preferences: { newsletter: { callsToAction: false } },
    });
    expect(heldMailVerdict(message(), left)).toEqual({
      send: false,
      reason: "noConsent",
    });
    expect(
      heldMailVerdict(
        message(),
        consent({ admin: true, preferences: { teamMail: false } }),
      ),
    ).toEqual({ send: false, reason: "teamOptOut" });
    expect(heldMailVerdict(message(), consent({ disabled: true }))).toEqual({
      send: false,
      reason: "disabled",
    });
    expect(
      heldMailVerdict(message(), consent({ emailVerified: false })),
    ).toEqual({ send: false, reason: "unverified" });
    expect(heldMailVerdict(message(), consent({ email: null }))).toEqual({
      send: false,
      reason: "noAddress",
    });
    // Somebody the audience no longer has at all.
    expect(heldMailVerdict(message(), undefined)).toEqual({
      send: false,
      reason: "unknown",
    });
  });

  it("judges the topic the message was written about", () => {
    // Switched on the other topic only: this message is not about it.
    const other = consent({
      preferences: { newsletter: { recentPeople: true } },
    });
    expect(heldMailVerdict(message(), other)).toEqual({
      send: false,
      reason: "noConsent",
    });
    expect(heldMailVerdict(message({ topic: "recentPeople" }), other)).toEqual({
      send: true,
    });
    // No topic, no saying what they agreed to.
    for (const topic of [undefined, "", "wszystko"]) {
      expect(heldMailVerdict(message({ topic }), consent())).toEqual({
        send: false,
        reason: "noConsent",
      });
    }
  });

  it("sends only to the address the account has now", () => {
    expect(
      heldMailVerdict(message(), consent({ email: "nowy@example.com" })),
    ).toEqual({ send: false, reason: "addressChanged" });
    expect(
      heldMailVerdict(message(), consent({ email: "Anna@Example.com" })),
    ).toEqual({ send: true });
    for (const to of [[], ["anna@example.com", "b@example.com"], "anna"]) {
      expect(heldMailVerdict(message({ to }), consent())).toEqual({
        send: false,
        reason: "addressChanged",
      });
    }
  });
});

describe("withdrawal", () => {
  it("closes the message in a state the extension and the release leave alone, with nothing to count it by", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(withdrawal("noConsent", now)).toEqual({
      delivery: { state: "WITHDRAWN", endTime: now },
      withdrawn_reason: "noConsent",
    });
  });
});

describe("loadConsent", () => {
  it("reads an account from the auth service and the two fields of its users document", async () => {
    const r = reads(
      [account("anna", { customClaims: { admin: true, owner: true } })],
      {
        "users/anna": {
          newsletter: { callsToAction: true, recentPeople: "yes" },
          teamMail: false,
          displayName: "Anna",
        },
      },
    );

    const found = await loadConsent(r, ["anna"]);
    expect(found.get("anna")).toEqual({
      email: "anna@example.com",
      emailVerified: true,
      disabled: false,
      admin: true,
      // Booleans only: anything else in somebody's own document is no answer.
      preferences: { newsletter: { callsToAction: true }, teamMail: false },
    });
    expect(r.getUsers).toHaveBeenCalledWith([{ uid: "anna" }]);
    expect(r.getAll.mock.calls[0]!.at(-1)).toEqual({
      fieldMask: ["newsletter", "teamMail"],
    });
  });

  it("leaves out an account deleted since", async () => {
    const found = await loadConsent(reads([], {}), ["gone"]);
    expect(found.has("gone")).toBe(false);
  });

  it("reads a reader without an account from their subscriber document, while it is confirmed", async () => {
    const r = reads([], {
      "newsletterSubscribers/abc": {
        email: "bez.konta@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: false },
      },
      "newsletterSubscribers/def": {
        email: "odszedl@example.com",
        status: "unsubscribed",
        topics: { callsToAction: false, recentPeople: false },
      },
    });

    const found = await loadConsent(r, ["sub_abc", "sub_def", "sub_ghi"]);
    expect(found.get("sub_abc")).toEqual({
      email: "bez.konta@example.com",
      emailVerified: true,
      disabled: false,
      admin: false,
      preferences: {
        newsletter: { callsToAction: true, recentPeople: false },
      },
    });
    expect([...found.keys()]).toEqual(["sub_abc"]);
  });

  it("leaves out a reader without an account whose address has an account now, as the audience does", async () => {
    const r = reads([account("ania")], {
      "newsletterSubscribers/abc": {
        email: "ania@example.com",
        status: "confirmed",
        topics: { callsToAction: true },
      },
    });

    const found = await loadConsent(r, ["sub_abc"]);
    expect(found.has("sub_abc")).toBe(false);
    expect(r.getUsers).toHaveBeenCalledWith([{ email: "ania@example.com" }]);
  });

  it("asks the auth service a hundred at a time, and only for what it can take", async () => {
    const uids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    const r = reads(
      uids.map((uid) => account(uid)),
      {},
    );

    const found = await loadConsent(r, [...uids, "", "a/b", "x".repeat(129)]);
    expect(found.size).toBe(150);
    expect(r.getUsers.mock.calls.map(([ids]) => ids.length)).toEqual([100, 50]);
  });

  it("reads nothing for nobody", async () => {
    const r = reads([], {});
    expect((await loadConsent(r, [])).size).toBe(0);
    expect(r.getUsers).not.toHaveBeenCalled();
    expect(r.getAll).not.toHaveBeenCalled();
  });
});

describe("the reads a send and a release share", () => {
  it("take only booleans off a users document", () => {
    expect(
      mailPreferences({
        newsletter: { callsToAction: true, recentPeople: 1 },
        teamMail: "no",
      }),
    ).toEqual({ newsletter: { callsToAction: true } });
    expect(mailPreferences(undefined)).toEqual({});
  });

  it("take the admin claim, and nothing else, as being on the team", () => {
    const facts = (customClaims: Data | undefined) =>
      accountConsent(account("a", { customClaims }), {}).admin;
    expect(facts({ admin: true })).toBe(true);
    expect(facts({ admin: "true", newAdmin: true })).toBe(false);
    expect(facts(undefined)).toBe(false);
  });

  it("take a subscriber only while confirmed", () => {
    expect(
      confirmedSubscriber({
        email: "a@example.com",
        status: "confirmed",
        topics: { callsToAction: true, recentPeople: "tak" },
      }),
    ).toEqual({ email: "a@example.com", topics: { callsToAction: true } });
    expect(
      confirmedSubscriber({ email: "a@example.com", status: "pending" }),
    ).toBeNull();
    expect(confirmedSubscriber(undefined)).toBeNull();
  });
});

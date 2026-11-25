import { describe, it, expect } from "vitest";
import { emptyActivityCounts } from "../../shared/activity";
import type { AudienceMember } from "../../shared/campaigns";
import {
  CONFIRMATIONS_PER_DAY,
  confirmationIds,
  confirmReasonsFor,
  confirmReminderId,
  renderAddressConfirmation,
  renderConfirmReminder,
} from "../../shared/confirmAddress";

function member(overrides: Partial<AudienceMember> = {}): AudienceMember {
  return {
    uid: "u1",
    email: "anna@example.com",
    emailVerified: false,
    disabled: false,
    displayName: null,
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    lastSignInAt: null,
    lastSeenAt: null,
    activity: { counts: emptyActivityCounts(), total: 0 },
    preferences: {},
    ...overrides,
  };
}

const reading = {
  counts: { ...emptyActivityCounts(), reading: 12 },
  total: 12,
};

describe("confirmReasonsFor", () => {
  it("names what an unconfirmed account waits on, in the message's order", () => {
    expect(
      confirmReasonsFor(
        member({
          admin: true,
          activity: reading,
          preferences: { newsletter: { recentPeople: true } },
        }),
      ),
    ).toEqual(["newsletter", "team", "readings"]);
  });

  it("counts a yes to either topic as the newsletter", () => {
    expect(
      confirmReasonsFor(
        member({ preferences: { newsletter: { callsToAction: true } } }),
      ),
    ).toEqual(["newsletter"]);
  });

  it("writes to nobody who said no, never answered and read nothing", () => {
    expect(
      confirmReasonsFor(
        member({
          preferences: {
            newsletter: { callsToAction: false, recentPeople: false },
          },
        }),
      ),
    ).toEqual([]);
    expect(confirmReasonsFor(member())).toEqual([]);
  });

  it("leaves out an admin who switched team mail off", () => {
    expect(
      confirmReasonsFor(
        member({ admin: true, preferences: { teamMail: false } }),
      ),
    ).toEqual([]);
  });

  it("asks nothing of a confirmed, blocked or address-less account, or a subscriber", () => {
    const waiting = { activity: reading };
    expect(
      confirmReasonsFor(member({ ...waiting, emailVerified: true })),
    ).toEqual([]);
    expect(confirmReasonsFor(member({ ...waiting, disabled: true }))).toEqual(
      [],
    );
    expect(confirmReasonsFor(member({ ...waiting, email: null }))).toEqual([]);
    expect(
      confirmReasonsFor(member({ ...waiting, kind: "subscriber" })),
    ).toEqual([]);
  });
});

describe("confirmReminderId", () => {
  it("keys one reminder per account", () => {
    expect(confirmReminderId("abc")).toBe("confirmReminder_abc");
  });
});

describe("renderConfirmReminder", () => {
  const url = "https://koryta-pl.firebaseapp.com/__/auth/action?oobCode=x&a=1";

  it("says why, links the confirmation, and asks only once", () => {
    const mail = renderConfirmReminder({ reasons: ["newsletter"], url });
    expect(mail.subject).toBe("Potwierdź adres e-mail na koryta.pl");
    expect(mail.text).toBe(
      [
        "Twoje konto na koryta.pl jest zapisane na newsletter, ale adres nie jest potwierdzony, więc nic do Ciebie nie wysyłamy.",
        `Potwierdź adres: ${url}`,
        "To jedyne przypomnienie. Jeśli to nie Twoje konto, zignoruj tę wiadomość.",
      ].join("\n\n"),
    );
    expect(mail.html).toContain(`href="${url.replace("&", "&amp;")}"`);
    expect(mail.html).toContain(">Potwierdź adres</a>");
  });

  it("gives each reason its own line, newsletter first", () => {
    const mail = renderConfirmReminder({
      reasons: ["readings", "team"],
      url,
    });
    const team = mail.text.indexOf("Wiadomości dla zespołu");
    const readings = mail.text.indexOf("kolejne odczyty oświadczeń");
    expect(team).toBeGreaterThanOrEqual(0);
    expect(readings).toBeGreaterThan(team);
    expect(mail.text).not.toContain("newsletter");
  });
});

describe("confirmationIds", () => {
  it("gives an account one slot per confirmation mail of the day", () => {
    expect(confirmationIds("abc", "2026-11-25")).toEqual(
      Array.from(
        { length: CONFIRMATIONS_PER_DAY },
        (_, i) => `confirmAddress_abc_2026-11-25_${i + 1}`,
      ),
    );
  });
});

describe("renderAddressConfirmation", () => {
  it("asks to confirm, in the reminder's look, without calling itself a reminder", () => {
    const url = "https://koryta-pl.firebaseapp.com/__/auth/action?oobCode=x";
    const mail = renderAddressConfirmation({ url });
    expect(mail.subject).toBe("Potwierdź adres e-mail na koryta.pl");
    expect(mail.text).toBe(
      [
        "Potwierdź adres e-mail swojego konta na koryta.pl.",
        `Potwierdź adres: ${url}`,
        "Jeśli to nie Twoje konto, zignoruj tę wiadomość.",
      ].join("\n\n"),
    );
    expect(mail.html).toContain(`href="${url}"`);
  });
});

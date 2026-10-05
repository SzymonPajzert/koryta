import { describe, it, expect } from "vitest";
import {
  notificationDefaults,
  notificationEnabled,
  notificationKinds,
  notificationLabels,
  renderNotification,
} from "../../shared/notifications";
import { describeRole } from "../../shared/roles";

/** The mail the claims script queues when it changes somebody's role.
 *
 * The script is Python (data/pipelines/src/set_auth_claims.py) and writes its
 * own copy of this text; these tests pin the wording both sides were given, so
 * a change to either shows up as a difference here rather than as two
 * different emails. */

describe("roleChanged notification", () => {
  it("is a kind of its own, on unless switched off", () => {
    expect(notificationKinds).toContain("roleChanged");
    expect(notificationDefaults.roleChanged).toBe(true);
    expect(notificationEnabled("roleChanged", undefined)).toBe(true);
    expect(notificationEnabled("roleChanged", { roleChanged: false })).toBe(
      false,
    );
    // Turning off the mail about proposals says nothing about this one.
    expect(
      notificationEnabled("roleChanged", {
        revisionApproved: false,
        revisionRejected: false,
      }),
    ).toBe(true);
  });

  it("labels its switch on /profil", () => {
    expect(notificationLabels.roleChanged).toEqual({
      title: "Zmiana Twoich uprawnień",
      hint: "Gdy administrator nada lub odbierze Ci uprawnienia na stronie",
    });
  });

  it("says what the role is now, word for word", () => {
    const role = describeRole({ level: "admin", trial: true });
    const mail = renderNotification(
      { kind: "roleChanged", role },
      "https://koryta.pl",
    );

    expect(mail.subject).toBe("Zmiana Twoich uprawnień na koryta.pl");
    expect(mail.text).toBe(
      [
        "Dzień dobry,",
        "Twoje uprawnienia na koryta.pl się zmieniły. Teraz: Administrator (okres próbny).",
        "Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku sekund. Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.",
        "Ustawienia powiadomień: https://koryta.pl/profil",
      ].join("\n\n"),
    );
  });

  it("puts each paragraph of the text in the html, with the link live", () => {
    const mail = renderNotification(
      { kind: "roleChanged", role: "Zespół" },
      "https://koryta.pl/",
    );

    expect(mail.html).toBe(
      [
        "<p>Dzień dobry,</p>",
        "<p>Twoje uprawnienia na koryta.pl się zmieniły. Teraz: Zespół.</p>",
        "<p>Jeśli masz otwartą stronę, odświeży uprawnienia sama w ciągu kilku sekund. Jeśli menu się nie zmieni, wyloguj się i zaloguj ponownie.</p>",
        '<p>Ustawienia powiadomień: <a href="https://koryta.pl/profil">https://koryta.pl/profil</a></p>',
      ].join("\n"),
    );
  });

  it("links to the deployment it was rendered against", () => {
    const mail = renderNotification(
      { kind: "roleChanged", role: "Uczestnik" },
      "http://localhost:3000",
    );

    expect(mail.text).toContain("http://localhost:3000/profil");
    expect(mail.html).toContain('href="http://localhost:3000/profil"');
  });

  it("escapes the role in the html", () => {
    // Every role comes from `describeRole`, but the renderer does not know
    // that, and the html is a document.
    const mail = renderNotification(
      { kind: "roleChanged", role: "<b>admin</b>" },
      "https://koryta.pl",
    );

    expect(mail.html).toContain("&lt;b&gt;admin&lt;/b&gt;");
    expect(mail.text).toContain("Teraz: <b>admin</b>.");
  });
});

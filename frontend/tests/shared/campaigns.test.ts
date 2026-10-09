import { describe, it, expect } from "vitest";
import {
  campaignEligibility,
  campaignLinks,
  mailPromptAnswered,
  presetIncludes,
  renderCampaign,
  unsubscribeUrls,
  type AudienceMember,
  type CampaignContent,
  type CampaignRender,
} from "../../shared/campaigns";
import { emptyActivityCounts } from "../../shared/activity";

const NOW = new Date("2026-10-09T12:00:00Z");

function member(overrides: Partial<AudienceMember> = {}): AudienceMember {
  return {
    uid: "u1",
    email: "anna@example.com",
    emailVerified: true,
    disabled: false,
    displayName: "Anna",
    admin: false,
    newAdmin: false,
    owner: false,
    createdAt: "2026-01-01T00:00:00Z",
    lastSignInAt: null,
    lastSeenAt: null,
    activity: { counts: emptyActivityCounts(), total: 0 },
    preferences: {},
    ...overrides,
  };
}

describe("campaignEligibility", () => {
  it("needs the recipient to have asked for the topic", () => {
    expect(campaignEligibility(member(), "callsToAction")).toEqual({
      eligible: false,
      reason: "noConsent",
    });
    expect(
      campaignEligibility(
        member({ preferences: { newsletter: { callsToAction: true } } }),
        "callsToAction",
      ),
    ).toEqual({ eligible: true, via: "optedIn" });
  });

  it("does not read consent to one topic as consent to the other", () => {
    expect(
      campaignEligibility(
        member({ preferences: { newsletter: { recentPeople: true } } }),
        "callsToAction",
      ),
    ).toEqual({ eligible: false, reason: "noConsent" });
  });

  it("writes to an administrator as a member of the team", () => {
    expect(
      campaignEligibility(member({ admin: true }), "callsToAction"),
    ).toEqual({ eligible: true, via: "team" });
  });

  it("lets an administrator turn team mail off", () => {
    expect(
      campaignEligibility(
        member({ admin: true, preferences: { teamMail: false } }),
        "callsToAction",
      ),
    ).toEqual({ eligible: false, reason: "teamOptOut" });
  });

  it("still writes to an administrator who asked for the topic itself", () => {
    // Turning team mail off is not turning off a newsletter they signed up for.
    expect(
      campaignEligibility(
        member({
          admin: true,
          preferences: {
            teamMail: false,
            newsletter: { callsToAction: true },
          },
        }),
        "callsToAction",
      ),
    ).toEqual({ eligible: true, via: "optedIn" });
  });

  it("ignores a switched-off topic on an administrator", () => {
    // /profil saves both newsletter switches at once, so `false` on one of
    // them says nothing about team mail.
    expect(
      campaignEligibility(
        member({
          admin: true,
          preferences: { newsletter: { callsToAction: false } },
        }),
        "callsToAction",
      ),
    ).toEqual({ eligible: true, via: "team" });
  });

  it("never writes to an address nobody confirmed", () => {
    // Anybody can register with anybody's address.
    expect(
      campaignEligibility(
        member({
          admin: true,
          emailVerified: false,
          preferences: { newsletter: { callsToAction: true } },
        }),
        "callsToAction",
      ),
    ).toEqual({ eligible: false, reason: "unverified" });
  });

  it("skips accounts without an address and blocked ones", () => {
    expect(
      campaignEligibility(member({ email: null, admin: true }), "recentPeople"),
    ).toEqual({ eligible: false, reason: "noAddress" });
    expect(
      campaignEligibility(
        member({ disabled: true, admin: true }),
        "recentPeople",
      ),
    ).toEqual({ eligible: false, reason: "disabled" });
  });
});

describe("presetIncludes", () => {
  const active = member({ lastSeenAt: "2026-09-20T10:00:00Z" });
  const lapsed = member({ lastSeenAt: "2026-08-01T10:00:00Z" });
  const admin = member({ admin: true, lastSeenAt: null });

  it("puts administrators and recently active people in the pilot", () => {
    expect(presetIncludes("pilot", admin, NOW)).toBe(true);
    expect(presetIncludes("pilot", active, NOW)).toBe(true);
    expect(presetIncludes("pilot", lapsed, NOW)).toBe(false);
  });

  it("counts the last 30 days as recent", () => {
    expect(
      presetIncludes(
        "active",
        member({ lastSeenAt: "2026-09-09T12:00:01Z" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      presetIncludes(
        "active",
        member({ lastSeenAt: "2026-09-09T11:59:59Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("has a preset for administrators alone and one for everybody", () => {
    expect(presetIncludes("admins", admin, NOW)).toBe(true);
    expect(presetIncludes("admins", active, NOW)).toBe(false);
    expect(presetIncludes("everyone", lapsed, NOW)).toBe(true);
  });
});

const CONTENT: CampaignContent = {
  subject: "Potrzebujemy Twojej pomocy",
  body: "Pierwszy akapit.\n\nDrugi akapit,\nw dwóch liniach.",
  ctaLabel: "Sprawdź kolejną osobę",
  ctaPath: "/eksploruj/nowe",
  topic: "callsToAction",
  includeStats: false,
};

function render(overrides: Partial<CampaignRender> = {}) {
  return renderCampaign({
    campaignId: "pilot-1",
    content: CONTENT,
    via: "optedIn",
    personal: null,
    community: null,
    siteUrl: "https://koryta.pl",
    unsubscribe: unsubscribeUrls("https://koryta.pl", {
      uid: "u1",
      token: "tok",
      topic: "callsToAction",
    }),
    ...overrides,
  });
}

describe("renderCampaign", () => {
  it("keeps the subject and the paragraphs as written", () => {
    const mail = render();
    expect(mail.subject).toBe("Potrzebujemy Twojej pomocy");
    expect(mail.text).toContain("Pierwszy akapit.");
    expect(mail.html).toContain("<p>Pierwszy akapit.</p>");
    expect(mail.html).toContain("<p>Drugi akapit,<br>w dwóch liniach.</p>");
  });

  it("escapes what the owner typed", () => {
    const mail = render({
      content: { ...CONTENT, body: "<script>alert(1)</script> & co" },
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; co",
    );
  });

  it("tags links to the site so a visit can be traced to the campaign", () => {
    const mail = render();
    const cta =
      "https://koryta.pl/eksploruj/nowe?utm_source=newsletter&utm_medium=email&utm_campaign=pilot-1";
    expect(mail.html).toContain(`href="${cta.replace(/&/g, "&amp;")}"`);
    expect(mail.html).toContain(">Sprawdź kolejną osobę</a>");
    expect(mail.text).toContain(`Sprawdź kolejną osobę: ${cta}`);
  });

  it("turns [label](link) into a link, on the site or off it", () => {
    const mail = render({
      content: {
        ...CONTENT,
        body: "Zobacz [ranking](/eksploruj/statystyki) i [KRS](https://ekrs.ms.gov.pl/).",
      },
    });
    expect(mail.html).toContain(
      'href="https://koryta.pl/eksploruj/statystyki?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=pilot-1">ranking</a>',
    );
    // Somebody else's site gets no tracking parameters.
    expect(mail.html).toContain('href="https://ekrs.ms.gov.pl/">KRS</a>');
    expect(mail.text).toContain(
      "ranking (https://koryta.pl/eksploruj/statystyki?utm_source=newsletter&utm_medium=email&utm_campaign=pilot-1)",
    );
  });

  it("does not link a scheme it does not trust", () => {
    const mail = render({
      content: { ...CONTENT, body: "[kliknij](javascript:alert(1))" },
    });
    expect(mail.html).not.toContain('href="javascript');
    expect(mail.html).toContain("[kliknij](javascript:alert(1))");
  });

  it("leaves the button out when it has no label", () => {
    const mail = render({ content: { ...CONTENT, ctaLabel: "" } });
    expect(mail.html).not.toContain("utm_campaign");
  });

  it("says why the reader is getting it, and how to stop", () => {
    const optedIn = render();
    expect(optedIn.text).toContain("„Wezwania do działania”");
    expect(optedIn.text).toContain(
      "https://koryta.pl/wypisz?u=u1&t=tok&k=callsToAction",
    );
    expect(optedIn.html).toContain(">Wypisz się</a>");

    const team = render({ via: "team" });
    expect(team.text).toContain("zespołu koryta.pl");
  });

  it("names the campaign in the unsubscribe link when told it", () => {
    expect(
      unsubscribeUrls("https://koryta.pl/", {
        uid: "u 1",
        token: "a/b",
        topic: "recentPeople",
        campaignId: "2026-10-09-pilot",
      }).pageUrl,
    ).toBe(
      "https://koryta.pl/wypisz?u=u%201&t=a%2Fb&k=recentPeople&c=2026-10-09-pilot",
    );
  });

  it("offers one-click unsubscribe to mail clients", () => {
    expect(render().headers).toEqual({
      "List-Unsubscribe":
        "<https://koryta.pl/api/mail/unsubscribe?u=u1&t=tok&k=callsToAction>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("tells a contributor what they did, in the right Polish forms", () => {
    const counts = {
      ...emptyActivityCounts(),
      vote: 22,
      revision: 1,
      noteSource: 5,
    };
    const mail = render({
      content: { ...CONTENT, includeStats: true },
      personal: { days: 90, counts, total: 28 },
    });
    expect(mail.text).toContain(
      "Twój wkład w ostatnich 90 dniach: 22 oceny, 1 propozycja zmiany i 5 źródeł lub zgłoszeń.",
    );
  });

  it("says nothing about the reader's own work when there was none", () => {
    const mail = render({
      content: { ...CONTENT, includeStats: true },
      personal: { days: 90, counts: emptyActivityCounts(), total: 0 },
    });
    expect(mail.text).not.toContain("Twój wkład");
  });

  it("shows what everybody did and what is waiting", () => {
    const mail = render({
      content: { ...CONTENT, includeStats: true },
      community: {
        days: 30,
        votes: 412,
        voters: 9,
        publications: 23,
        toCheck: 1204,
      },
    });
    expect(mail.text).toContain(
      "Ostatnie 30 dni na koryta.pl: 412 ocen od 9 osób i 23 opublikowane strony.",
    );
    // Grouped as „1 204” where the runtime groups four digits, „1204” where not.
    expect(mail.text).toMatch(/W kolejce do sprawdzenia: 1\s?204 osoby\./);
  });

  it("leaves the numbers out unless the campaign asks for them", () => {
    const mail = render({
      personal: {
        days: 90,
        counts: { ...emptyActivityCounts(), vote: 3 },
        total: 3,
      },
      community: {
        days: 30,
        votes: 412,
        voters: 9,
        publications: 23,
        toCheck: null,
      },
    });
    expect(mail.text).not.toContain("Twój wkład");
    expect(mail.text).not.toContain("Ostatnie 30 dni");
  });
});

describe("campaignLinks", () => {
  it("lists every site link the mail carries, for a preview to check", () => {
    expect(
      campaignLinks({
        ...CONTENT,
        body: "[a](/osoba/x) [b](https://example.com) [c](/eksploruj/tabela?q=1#top)",
      }),
    ).toEqual(["/osoba/x", "/eksploruj/tabela?q=1#top", "/eksploruj/nowe"]);
  });
});

describe("mailPromptAnswered", () => {
  it("counts any stored choice, a no included, as an answer", () => {
    expect(mailPromptAnswered(null)).toBe(false);
    expect(mailPromptAnswered({})).toBe(false);
    expect(mailPromptAnswered({ newsletter: null })).toBe(false);
    expect(
      mailPromptAnswered({
        newsletter: { callsToAction: false, recentPeople: false },
      }),
    ).toBe(true);
    expect(mailPromptAnswered({ newsletter: {} })).toBe(true);
  });
});

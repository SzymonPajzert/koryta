import { describe, it, expect } from "vitest";
import {
  confirmationUrl,
  looksLikeEmail,
  normaliseEmail,
  renderConfirmation,
} from "../../shared/newsletterSignup";

describe("normaliseEmail", () => {
  it("makes one subscriber of one address however it was typed", () => {
    expect(normaliseEmail("  Anna.Nowak@Example.COM ")).toBe(
      "anna.nowak@example.com",
    );
  });
});

describe("looksLikeEmail", () => {
  it("takes ordinary addresses", () => {
    expect(looksLikeEmail("anna@example.com")).toBe(true);
    expect(looksLikeEmail("a.b+newsletter@sub.example.com.pl")).toBe(true);
  });

  it("turns away what cannot be one address", () => {
    for (const bad of [
      "",
      "anna",
      "anna@",
      "@example.com",
      "anna@example",
      "anna nowak@example.com",
      "anna@example.com, jan@example.com",
      "<anna@example.com>",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
  });
});

describe("the confirmation mail", () => {
  const url = confirmationUrl("https://koryta.pl/", {
    id: "abc123",
    token: "to/ken+",
  });

  it("links to the page that asks before it confirms", () => {
    expect(url).toBe(
      "https://koryta.pl/newsletter/potwierdz?s=abc123&t=to%2Fken%2B",
    );
  });

  it("carries the link in both formats, and says what to do if it was not you", () => {
    const mail = renderConfirmation({ url });
    expect(mail.subject).toBe("Potwierdź zapis na newsletter koryta.pl");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain(`href="${url.replace(/&/g, "&amp;")}"`);
    expect(mail.text).toContain("Jeśli to nie Ty, zignoruj tę wiadomość");
    expect(mail.text).toContain("usuniemy po 7 dniach");
  });

  it("writes no dash but a hyphen", () => {
    const mail = renderConfirmation({ url });
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(
      /[\u2013\u2014]/,
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  maskedContributorName,
  publicProfileDefault,
  publicProfileEnabled,
  publicProfileLabel,
} from "../../shared/profile";

describe("publicProfileEnabled", () => {
  it("keeps a name hidden until its owner says otherwise", () => {
    // The default is the whole privacy guarantee: an account that has never
    // opened /profil must not be named to strangers.
    expect(publicProfileDefault).toBe(false);
    expect(publicProfileEnabled(undefined)).toBe(false);
    expect(publicProfileEnabled(null)).toBe(false);
  });

  it("honours an explicit choice either way", () => {
    expect(publicProfileEnabled(true)).toBe(true);
    expect(publicProfileEnabled(false)).toBe(false);
  });
});

describe("maskedContributorName", () => {
  it("keeps the first letter and nothing else", () => {
    expect(maskedContributorName("Anna Nowak", 1)).toBe("A•••••");
  });

  it("hides how long the name is", () => {
    // The length of a name is an identifier of its own in a contributor pool
    // this size, so every mask is the same width whatever it covers.
    expect(maskedContributorName("Bo", 1)).toBe(
      maskedContributorName("Bartłomiej Wiśniewski-Kowalczyk", 2),
    );
  });

  it("falls back to the rank when there is no name to mask", () => {
    expect(maskedContributorName(null, 4)).toBe("Uczestnik #4");
    expect(maskedContributorName(undefined, 4)).toBe("Uczestnik #4");
    expect(maskedContributorName("   ", 4)).toBe("Uczestnik #4");
  });

  it("takes the letter from a name that is padded", () => {
    expect(maskedContributorName("  Zofia", 3)).toBe("Z•••••");
  });

  it("does not split a character in half", () => {
    // Iterating a string by index would cut a surrogate pair and emit half of
    // an emoji or of a rarer script's letter.
    expect(maskedContributorName("𝔄nna", 1)).toBe("𝔄•••••");
  });
});

describe("publicProfileLabel", () => {
  it("says the switch opens a profile, and what is on it", () => {
    // The people who turned it on before profiles existed get one without
    // being asked again; this sentence is what they agreed to.
    const { hint } = publicProfileLabel;

    expect(hint).toContain("/uczestnik/");
    for (const shown of [
      "nazwą",
      "zdjęciem (jeśli dodasz własne)",
      "miesiącem dołączenia",
      "liczbą ocen, notatek i propozycji",
    ]) {
      expect(hint).toContain(shown);
    }
  });

  it("still says administrators see the name either way", () => {
    expect(publicProfileLabel.hint).toContain(
      "Administratorzy widzą Twoją nazwę niezależnie od tego ustawienia.",
    );
  });
});

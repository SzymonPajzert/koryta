import { describe, it, expect } from "vitest";
import { companyShortName, normalizePersonName } from "../../shared/names";

describe("normalizePersonName", () => {
  it("ignores case and diacritics", () => {
    // What the article printed vs what the register stored: the same person.
    expect(normalizePersonName("Rafał Trzaskowski")).toBe(
      normalizePersonName("RAFAL TRZASKOWSKI"),
    );
    expect(normalizePersonName("Szymon Hołownia")).toBe("szymon holownia");
    expect(normalizePersonName("Paweł Wnukowski")).toBe("pawel wnukowski");
  });

  it("treats a hyphenated surname as two words", () => {
    expect(normalizePersonName("Anna Kowalska-Nowak")).toBe(
      normalizePersonName("Anna Kowalska Nowak"),
    );
  });

  it("collapses surrounding and repeated whitespace", () => {
    expect(normalizePersonName("  Jan   Kowalski\n")).toBe("jan kowalski");
  });

  it("keeps different people apart", () => {
    expect(normalizePersonName("Piotr Gajda")).not.toBe(
      normalizePersonName("Krzysztof Kozłowski"),
    );
    // A surname on its own is not the same key as the full name, so a fact
    // naming only "Obajtek" is left unmatched rather than attached to a guess.
    expect(normalizePersonName("Obajtek")).not.toBe(
      normalizePersonName("Daniel Obajtek"),
    );
  });

  it("has no key for a name made only of punctuation", () => {
    expect(normalizePersonName("—")).toBe("");
  });
});

describe("companyShortName", () => {
  it("abbreviates the legal form a register spells out", () => {
    expect(
      companyShortName("URTICA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"),
    ).toBe("URTICA sp. z o.o.");
    expect(companyShortName("POCZTA POLSKA SPÓŁKA AKCYJNA")).toBe(
      "POCZTA POLSKA S.A.",
    );
    expect(companyShortName("ZAKŁAD USŁUG SPÓŁKA JAWNA")).toBe(
      "ZAKŁAD USŁUG sp.j.",
    );
  });

  it("takes the longest form first, so a compound one is not half-matched", () => {
    // Ends with "SPÓŁKA KOMANDYTOWA" too; matching that first would leave the
    // spelled-out "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" in the name.
    expect(
      companyShortName(
        "CLIMAMEDIC SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWA",
      ),
    ).toBe("CLIMAMEDIC sp. z o.o. sp.k.");
  });

  it("drops the punctuation that belonged to the suffix", () => {
    expect(companyShortName("AB, SPÓŁKA AKCYJNA")).toBe("AB S.A.");
    expect(companyShortName("AB - SPÓŁKA AKCYJNA")).toBe("AB S.A.");
  });

  it("leaves a name that is only a legal form alone", () => {
    expect(companyShortName("SPÓŁKA AKCYJNA")).toBe("SPÓŁKA AKCYJNA");
  });

  it("leaves everything else exactly as the register wrote it", () => {
    // The site's own company nodes are ALL CAPS from the same registers, so
    // lowercasing here would make a contract row the odd one out.
    expect(companyShortName("UNIWERSYTET WARSZAWSKI")).toBe(
      "UNIWERSYTET WARSZAWSKI",
    );
    expect(
      companyShortName('"NOWA ERA" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ'),
    ).toBe('"NOWA ERA" sp. z o.o.');
  });

  it("survives an absent name", () => {
    expect(companyShortName(null)).toBe("");
    expect(companyShortName(undefined)).toBe("");
    expect(companyShortName("   ")).toBe("");
  });
});

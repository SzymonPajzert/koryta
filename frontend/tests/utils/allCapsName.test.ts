import { describe, it, expect } from "vitest";
import { isAllCapsName } from "~/utils/allCapsName";

/** A company page sets its h1 one size down when the name is in capitals, as
 * most register names are: capitals carry about a third more mass than mixed
 * case (card/CompanySummary.vue). */
describe("isAllCapsName", () => {
  it("knows a register name in capitals", () => {
    expect(isAllCapsName("PKP LINIA HUTNICZA SZEROKOTOROWA")).toBe(true);
    // Polish capitals count as capitals.
    expect(isAllCapsName("ENERGA SPÓŁKA AKCYJNA")).toBe(true);
  });

  it("leaves a name in mixed case alone", () => {
    expect(isAllCapsName("Jan Kowalski")).toBe(false);
    expect(isAllCapsName("Orlen S.A.")).toBe(false);
  });

  it("does not count the town the site appends in brackets", () => {
    expect(isAllCapsName("PKP LINIA HUTNICZA SZEROKOTOROWA (Zamość)")).toBe(
      true,
    );
    // Nothing but the town is no name in capitals.
    expect(isAllCapsName("(Zamość)")).toBe(false);
  });

  it("takes mostly capitals, so a register name keeps its „Sp. z o.o.” and „im.”", () => {
    expect(isAllCapsName("POLSKA GRUPA ZBROJENIOWA Sp. z o.o.")).toBe(true);
    expect(isAllCapsName("SZPITAL WOJEWÓDZKI im. JANA PAWŁA II")).toBe(true);
  });

  it("is decided by the capitals, not the length", () => {
    // The rule is one step down for every name in capitals, short ones too.
    expect(isAllCapsName("PKP")).toBe(true);
    expect(isAllCapsName("ORLEN (Płock)")).toBe(true);
  });

  it("counts only letters", () => {
    expect(isAllCapsName("PKP - 2 / „S”")).toBe(true);
    expect(isAllCapsName("123 / 456")).toBe(false);
  });

  it("says no for a missing or empty name", () => {
    expect(isAllCapsName(undefined)).toBe(false);
    expect(isAllCapsName("")).toBe(false);
  });
});

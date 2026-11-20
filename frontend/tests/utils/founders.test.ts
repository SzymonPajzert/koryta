import { describe, it, expect } from "vitest";
import { founderNoun, foundedParticiple } from "../../app/utils/founders";

describe("founderNoun", () => {
  it("calls a foundation's founder its fundator", () => {
    expect(founderNoun({ legalForm: "FUNDACJA", name: "FUNDACJA PZU" })).toBe(
      "Fundator",
    );
  });

  it("reads the name where the register gave no form", () => {
    // Polska Fundacja Promocji Kadr: no `formaPrawna` in its odpis.
    expect(founderNoun({ name: "POLSKA FUNDACJA PROMOCJI KADR" })).toBe(
      "Fundator",
    );
  });

  it("calls anybody else's founder its założyciel", () => {
    expect(
      founderNoun({
        legalForm: "ZWIĄZEK PRACODAWCÓW",
        name: "ZWIĄZEK PRACODAWCÓW POLSKA MIEDŹ",
      }),
    ).toBe("Założyciel");
    expect(founderNoun(undefined)).toBe("Założyciel");
  });
});

describe("foundedParticiple", () => {
  it("agrees with the founded body's legal form", () => {
    expect(foundedParticiple({ legalForm: "FUNDACJA" })).toBe("założona");
    expect(
      foundedParticiple({
        legalForm: "STOWARZYSZENIE KULTURY FIZYCZNEJ",
        name: 'MIEJSKI KLUB SPORTOWY "ZAGŁĘBIE" LUBIN',
      }),
    ).toBe("założone");
    expect(foundedParticiple({ legalForm: "ZWIĄZEK PRACODAWCÓW" })).toBe(
      "założony",
    );
  });

  it("falls back to the name, and then to a foundation", () => {
    expect(foundedParticiple({ name: "STOWARZYSZENIE X" })).toBe("założone");
    expect(foundedParticiple({ name: "POLSKA FUNDACJA NARODOWA" })).toBe(
      "założona",
    );
    expect(foundedParticiple(undefined)).toBe("założona");
  });
});

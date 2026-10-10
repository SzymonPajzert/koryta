import { describe, it, expect } from "vitest";
import {
  companyIdentifiers,
  isValidKrs,
  isValidNip,
  isValidRegon,
  normalizeKrs,
  normalizeNip,
  normalizeRegon,
} from "../../shared/identifiers";

// Numbers made up to satisfy each register's check digit, not taken from any
// particular institution.
const NIP = "5260250274";
const REGON = "123456785";
const REGON_LOCAL_UNIT = "12345678512347";

describe("isValidNip", () => {
  it("accepts a well formed NIP", () => {
    expect(isValidNip(NIP)).toBe(true);
  });

  it("accepts one written the way it is printed", () => {
    expect(isValidNip("526-025-02-74")).toBe(true);
    expect(isValidNip("PL5260250274")).toBe(true);
    expect(isValidNip(" 526 025 02 74 ")).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    // The last digit is what the other nine add up to, so a typo anywhere is
    // caught rather than stored as a number nobody can look up.
    expect(isValidNip("5260250275")).toBe(false);
    expect(isValidNip("5260250724")).toBe(false);
  });

  it("rejects anything that is not ten digits", () => {
    expect(isValidNip("")).toBe(false);
    expect(isValidNip("526025027")).toBe(false);
    expect(isValidNip("52602502740")).toBe(false);
    expect(isValidNip("526025027X")).toBe(false);
  });

  it("rejects a number whose remainder is 10", () => {
    // NIP has no digit for that remainder - unlike REGON, which reads it as 0 -
    // so no last digit can rescue this one.
    expect(isValidNip("1234567890")).toBe(false);
    expect(isValidNip("1234567891")).toBe(false);
  });
});

describe("isValidRegon", () => {
  it("accepts a nine digit REGON", () => {
    expect(isValidRegon(REGON)).toBe(true);
  });

  it("accepts a fourteen digit one, for a local unit", () => {
    expect(isValidRegon(REGON_LOCAL_UNIT)).toBe(true);
  });

  it("rejects a local unit whose entity digits do not check out", () => {
    // The first nine are the entity's own REGON. Without checking those, a typo
    // there would hide behind the fourteenth digit.
    expect(isValidRegon("12345678612347")).toBe(false);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidRegon("123456784")).toBe(false);
  });

  it("rejects a length no register uses", () => {
    expect(isValidRegon("")).toBe(false);
    expect(isValidRegon("12345678")).toBe(false);
    expect(isValidRegon("1234567850")).toBe(false);
  });
});

describe("normalisation", () => {
  it("keeps the digits and drops the rest", () => {
    expect(normalizeNip("PL 526-025-02-74")).toBe("5260250274");
    expect(normalizeRegon("123 456 785")).toBe("123456785");
  });

  it("leaves a REGON starting with PL alone", () => {
    // Only a NIP is written with the country code, so those two letters stay
    // where they are and the number fails validation rather than being mangled
    // into a different one.
    expect(normalizeRegon("PL123456785")).toBe("PL123456785");
    expect(isValidRegon("PL123456785")).toBe(false);
  });
});

describe("normalizeKrs", () => {
  it("pads a number to the ten digits every uploaded page carries", () => {
    // Stored as typed, "81135" is a page neither ingest finds by 0000081135,
    // so the next company upload would give „Therma” another page.
    expect(normalizeKrs("81135")).toBe("0000081135");
    expect(normalizeKrs("0000081135")).toBe("0000081135");
  });

  it("drops the separators and the register's name", () => {
    expect(normalizeKrs(" 0000 081-135 ")).toBe("0000081135");
    expect(normalizeKrs("KRS 0000081135")).toBe("0000081135");
    expect(normalizeKrs("krs: 81135")).toBe("0000081135");
  });

  it("leaves what is not a number for validation to turn down", () => {
    expect(normalizeKrs("brak")).toBe("BRAK");
    expect(normalizeKrs("00000811350")).toBe("00000811350");
    expect(normalizeKrs("")).toBe("");
  });
});

describe("isValidKrs", () => {
  it("accepts a number as printed and as typed short", () => {
    expect(isValidKrs("0000081135")).toBe(true);
    expect(isValidKrs("81135")).toBe(true);
  });

  it("rejects free text, a number too long, and nought", () => {
    expect(isValidKrs("brak")).toBe(false);
    expect(isValidKrs("00000811350")).toBe(false);
    expect(isValidKrs("0")).toBe(false);
    expect(isValidKrs("")).toBe(false);
  });
});

describe("companyIdentifiers", () => {
  it("lists only the registers the place is actually in", () => {
    // What an institution outside KRS - a ministry, a wojewódzki fundusz - is
    // left with once there is no KRS number to show.
    expect(companyIdentifiers({ regonNumber: REGON, nipNumber: NIP })).toEqual([
      { register: "REGON", value: REGON },
      { register: "NIP", value: NIP },
    ]);
  });

  it("has nothing to show for a place with no number at all", () => {
    expect(companyIdentifiers({})).toEqual([]);
  });

  it("points a KRS number at the entry rejestr.io keeps for it", () => {
    expect(companyIdentifiers({ krsNumber: "0000348888" })).toEqual([
      {
        register: "KRS",
        value: "0000348888",
        url: "https://rejestr.io/krs/0000348888",
      },
    ]);
  });

  it("links a KRS number written with separators", () => {
    expect(companyIdentifiers({ krsNumber: " 0000 348-888 " })[0]?.url).toBe(
      "https://rejestr.io/krs/0000348888",
    );
  });

  it("leaves a KRS number that is not one unlinked", () => {
    // Free text got typed into the field at some point; a link built from it
    // would land on rejestr.io's 404 rather than on the company.
    expect(companyIdentifiers({ krsNumber: "brak" })[0]?.url).toBeUndefined();
  });
});

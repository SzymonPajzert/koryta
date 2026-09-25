import { describe, expect, it } from "vitest";
import {
  CONTRACT_LINK_SORTS,
  contractLinkGatedMostlyWeak,
  contractLinkMatchCount,
  contractLinkPermalinkId,
  contractLinkStrongTotal,
  contractLinkWeakTotal,
  contractLinksParams,
  normaliseClass,
  normaliseWojewodztwo,
  oneOf,
} from "../../app/composables/contractLinks";
import type { ContractLinkSummary } from "../../shared/contractLinks";

/** The 2026-09 export's shape, rounded: 420 findings, three quarters of the
 * money in class D, 96% of it gated. */
function summary(
  overrides: Partial<ContractLinkSummary> = {},
): ContractLinkSummary {
  return {
    links: 420,
    verified: 227,
    public: 36,
    gated: 384,
    gatedVerified: 191,
    inOfficeNow: 56,
    inOfficePeople: 54,
    total: 233_764_265,
    totalVerified: 120_000_000,
    totalGated: 224_633_098,
    byStrength: { A: 28, B: 38, C: 28, D: 326 },
    totalByStrength: {
      A: 6_326_238,
      B: 5_765_979,
      C: 49_835_285,
      D: 171_836_763,
    },
    byWojewodztwo: {
      podlaskie: { links: 13, total: 1_184_949, gated: 13 },
      mazowieckie: { links: 60, total: 30_000_000, gated: 52 },
    },
    computedAt: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

describe("contractLinksParams", () => {
  it("leaves the defaults out, so two spellings share a cache entry", () => {
    expect(contractLinksParams({ sort: "sila", status: "wszystkie" })).toEqual(
      {},
    );
  });

  it("passes the class filter through", () => {
    expect(contractLinksParams({ sort: "kwota", klasa: "A" })).toEqual({
      sort: "kwota",
      klasa: "A",
    });
  });
});

describe("what the url may say", () => {
  it("falls back to the default for a value nobody offers", () => {
    expect(oneOf("kwota", CONTRACT_LINK_SORTS, "sila")).toBe("kwota");
    expect(oneOf("xyz", CONTRACT_LINK_SORTS, "sila")).toBe("sila");
    expect(oneOf(null, CONTRACT_LINK_SORTS, "sila")).toBe("sila");
  });

  it("reads a województwo however it was typed", () => {
    // Each of these was a 400 from the API and a false „nothing matches".
    expect(normaliseWojewodztwo("Podlaskie")).toBe("podlaskie");
    expect(normaliseWojewodztwo(" MAZOWIECKIE ")).toBe("mazowieckie");
    expect(normaliseWojewodztwo("Śląskie")).toBe("śląskie");
    // Decomposed diacritics, as some keyboards and url encoders produce them.
    expect(normaliseWojewodztwo("s\u0301la\u0328skie")).toBe("śląskie");
  });

  it("drops a województwo that is not one of the sixteen", () => {
    expect(normaliseWojewodztwo("x")).toBeNull();
    expect(normaliseWojewodztwo("podlasie")).toBeNull();
    expect(normaliseWojewodztwo("")).toBeNull();
    expect(normaliseWojewodztwo(null)).toBeNull();
  });

  it("reads a class in either case and nothing else", () => {
    expect(normaliseClass("a")).toBe("A");
    expect(normaliseClass("D")).toBe("D");
    expect(normaliseClass("E")).toBeNull();
    expect(normaliseClass("AB")).toBeNull();
    expect(normaliseClass(undefined)).toBeNull();
  });

  it("asks the server only about ids it could answer", () => {
    expect(contractLinkPermalinkId("cru_1234567890")).toBe("cru_1234567890");
    expect(contractLinkPermalinkId("ukryte_13")).toBe("ukryte_13");
    expect(contractLinkPermalinkId("cru_123")).toBeNull();
    expect(contractLinkPermalinkId("../widocznosc")).toBeNull();
    expect(contractLinkPermalinkId(null)).toBeNull();
  });
});

describe("contractLinkMatchCount", () => {
  const none = { status: "wszystkie", woj: null, klasa: null } as const;

  it("knows the count for no filter and for any single one", () => {
    expect(contractLinkMatchCount(summary(), none)).toBe(420);
    expect(
      contractLinkMatchCount(summary(), { ...none, status: "sprawdzone" }),
    ).toBe(227);
    expect(
      contractLinkMatchCount(summary(), { ...none, woj: "podlaskie" }),
    ).toBe(13);
    expect(contractLinkMatchCount(summary(), { ...none, klasa: "B" })).toBe(38);
  });

  it("does not guess a combination the summary has no count for", () => {
    // „małopolskie (44)" beside 18 verified cards is the bug this avoids.
    expect(
      contractLinkMatchCount(summary(), {
        status: "sprawdzone",
        woj: "podlaskie",
        klasa: null,
      }),
    ).toBeNull();
    expect(
      contractLinkMatchCount(summary(), {
        ...none,
        woj: "podlaskie",
        klasa: "A",
      }),
    ).toBeNull();
  });

  it("says nothing for a region with no findings, or before the summary", () => {
    expect(
      contractLinkMatchCount(summary(), { ...none, woj: "lubuskie" }),
    ).toBeNull();
    expect(contractLinkMatchCount(null, none)).toBeNull();
  });
});

describe("the headline's money", () => {
  it("leads with A-C and keeps D apart", () => {
    expect(contractLinkStrongTotal(summary())).toBe(
      6_326_238 + 5_765_979 + 49_835_285,
    );
    expect(contractLinkWeakTotal(summary())).toBe(171_836_763);
  });

  it("calls the gated money mostly weak only when it can prove it", () => {
    // D minus everything public (9.1 mln) is at least 162.7 of 224.6 mln gated.
    expect(contractLinkGatedMostlyWeak(summary())).toBe(true);
    // The same D, but most of it public: the floor is nowhere near half.
    expect(
      contractLinkGatedMostlyWeak(
        summary({ total: 233_764_265, totalGated: 100_000_000 }),
      ),
    ).toBe(false);
    expect(contractLinkGatedMostlyWeak(summary({ totalGated: 0 }))).toBe(false);
  });
});

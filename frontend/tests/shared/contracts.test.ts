import { describe, expect, it } from "vitest";
import {
  contractCounterparty,
  contractDocumentId,
  contractParties,
  contractPartyLabel,
  contractSourceUrl,
} from "../../shared/contracts";
import type { Contract, ContractParty } from "../../shared/contracts";
import { companyShortName } from "../../shared/names";

/** A contract with only the fields a test cares about spelled out.
 *
 * Every field the storage layer always writes is filled in here too, so that a
 * field added to `Contract` without a default fails this file rather than one
 * of the 149 683 documents it describes.
 */
function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    source: "cru",
    sourceId: "00000000-0000-4000-8000-000000000000",
    buyer: { role: "buyer", name: "URZĄD MIASTA", nip: "1132316427" },
    suppliers: [{ role: "supplier", name: "FIRMA", nip: "7740001454" }],
    nodeIds: [],
    nips: [],
    supplierNodeIds: [],
    linked: false,
    bothLinked: false,
    hasIndividual: false,
    valueSort: -1,
    signedSort: "1970-01-01",
    ...overrides,
  };
}

describe("contractDocumentId", () => {
  it("strips every hyphen out of the register's uuid", () => {
    // Ids on this site are parsed as the last dash-separated segment of a url
    // slug, so a document id containing dashes would resolve to its own tail
    // the day a contract earns a page - `parseEntityUrlSlug` would read
    // „000000000000" and find nothing.
    expect(
      contractDocumentId("cru", "3f2a1b0c-11d2-4e33-9f44-556677889900"),
    ).toBe("cru_3f2a1b0c11d24e339f44556677889900");
    expect(
      contractDocumentId("cru", "3f2a1b0c-11d2-4e33-9f44-556677889900"),
    ).not.toContain("-");
  });

  it("is the same id every time, which is what makes a re-ingest a no-op", () => {
    const once = contractDocumentId(
      "cru",
      "3f2a1b0c-11d2-4e33-9f44-556677889900",
    );
    const twice = contractDocumentId(
      "cru",
      "3f2a1b0c-11d2-4e33-9f44-556677889900",
    );
    expect(once).toBe(twice);
  });

  it("keeps the register in the id, so two registers cannot collide", () => {
    expect(contractDocumentId("cru", "abc")).toBe("cru_abc");
  });
});

describe("contractSourceUrl", () => {
  it("points at the register's own page for the contract", () => {
    expect(
      contractSourceUrl({ source: "cru", sourceId: "3f2a1b0c-11d2-4e33" }),
    ).toBe("https://rejestrumow.gov.pl/umowa/3f2a1b0c-11d2-4e33");
  });

  it("keeps the hyphens the document id drops", () => {
    // The register's route wants its own uuid, not ours. Building this from
    // the document id instead would 404 - silently, because every path on
    // rejestrumow.gov.pl answers 200 with the same application shell.
    expect(
      contractSourceUrl({ source: "cru", sourceId: "3f2a1b0c-11d2-4e33" }),
    ).toContain("-");
  });

  it("has no url for a register nobody has written a link for yet", () => {
    expect(
      contractSourceUrl({
        source: "msig" as Contract["source"],
        sourceId: "abc",
      }),
    ).toBeUndefined();
  });
});

describe("contractPartyLabel", () => {
  it("prints the registered name when there is one", () => {
    expect(
      contractPartyLabel({ role: "supplier", name: "POCZTA POLSKA S.A." }),
    ).toBe("POCZTA POLSKA S.A.");
  });

  it("names a private individual only as „osoba fizyczna”", () => {
    // The ingest never stores their name, so this is what the 18 505 contracts
    // with one on them render. A party carrying both would be a bug at the
    // storage boundary, and the name would win here - which is why the ingest
    // drops it rather than the template hiding it.
    expect(contractPartyLabel({ role: "supplier", kind: "osoba" })).toBe(
      "osoba fizyczna",
    );
  });

  it("says the register withheld the party rather than leaving a blank", () => {
    // 2 525 party rows in the first window. An empty cell reads as a bug in
    // this site rather than as a decision by a public body.
    expect(
      contractPartyLabel({
        role: "supplier",
        redaction: {
          basis: "art. 5 ust. 2 ustawy o dostępie do informacji publicznej",
        },
      }),
    ).toBe("strona utajniona");
  });

  it("falls back to an em dash, including for no party at all", () => {
    expect(contractPartyLabel({ role: "supplier" })).toBe("—");
    expect(contractPartyLabel(undefined)).toBe("—");
  });
});

describe("contractParties", () => {
  it("reads buyer first, which is the order the sentence reads in", () => {
    const parties = contractParties(contract());
    expect(parties.map((party) => party.role)).toEqual(["buyer", "supplier"]);
  });

  it("copes with a contract the register gave no suppliers for", () => {
    // The 42 `zrodlo === "wynik"` rows: indexed, but the register would not
    // serve their details, so `strony` is empty.
    expect(
      contractParties(
        contract({
          suppliers: [] as ContractParty[],
          detailsUnavailable: true,
        }),
      ),
    ).toHaveLength(1);
  });
});

describe("contractCounterparty", () => {
  const linked = contract({
    buyer: { role: "buyer", name: "URZĄD MIASTA", nodeId: "urzad" },
    suppliers: [
      { role: "supplier", name: "FIRMA", nodeId: "firma" },
      { role: "supplier", name: "DRUGA FIRMA", nodeId: "druga" },
    ],
  });

  it("is the supplier when this company is the buyer", () => {
    expect(contractCounterparty(linked, "urzad")?.nodeId).toBe("firma");
  });

  it("is the buyer when this company is a supplier, including a later one", () => {
    expect(contractCounterparty(linked, "firma")?.nodeId).toBe("urzad");
    expect(contractCounterparty(linked, "druga")?.nodeId).toBe("urzad");
  });

  it("reads „who paid whom” left to right when no company is asking", () => {
    // The public list at /umowy, where every row is about somebody else.
    expect(contractCounterparty(linked)?.nodeId).toBe("firma");
    expect(contractCounterparty(linked, "somebody-else")?.nodeId).toBe("firma");
  });

  it("has no counterparty when the register served no parties", () => {
    expect(
      contractCounterparty(contract({ suppliers: [] as ContractParty[] })),
    ).toBeUndefined();
  });
});

describe("companyShortName over the forms a contract row meets", () => {
  // `tests/shared/names.test.ts` pins the behaviour - longest form first,
  // punctuation, a name that is only a form. This pins the table itself,
  // because it is contract rows that pay for a gap in it: 27.2% of the 32 939
  // distinct party names in the first CRU window end in one of these, and the
  // spelled-out suffix is most of a two-line row on a phone.
  it.each([
    [
      "ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWO-AKCYJNA",
      "ALFA sp. z o.o. S.K.A.",
    ],
    [
      "ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWA",
      "ALFA sp. z o.o. sp.k.",
    ],
    ["ALFA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "ALFA sp. z o.o."],
    ["ALFA SPÓŁKA KOMANDYTOWO-AKCYJNA", "ALFA S.K.A."],
    ["ALFA SPÓŁKA KOMANDYTOWA", "ALFA sp.k."],
    ["ALFA SPÓŁKA PARTNERSKA", "ALFA sp.p."],
    ["ALFA SPÓŁKA EUROPEJSKA", "ALFA SE"],
    ["ALFA SPÓŁKA AKCYJNA", "ALFA S.A."],
    ["ALFA SPÓŁKA CYWILNA", "ALFA s.c."],
    ["ALFA SPÓŁKA JAWNA", "ALFA sp.j."],
  ])("shortens %s", (name, expected) => {
    expect(companyShortName(name)).toBe(expected);
  });

  it("leaves a name that is nothing but a form verbatim", () => {
    // Returning "" here would print an empty supplier on a real register row.
    expect(companyShortName("SPÓŁKA AKCYJNA")).toBe("SPÓŁKA AKCYJNA");
  });

  it("takes the longest form first", () => {
    expect(
      companyShortName(
        "ZAKŁAD ROBÓT SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWA",
      ),
    ).toBe("ZAKŁAD ROBÓT sp. z o.o. sp.k.");
  });
});

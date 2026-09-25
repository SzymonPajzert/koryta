import { describe, expect, it } from "vitest";
import {
  amountRangeLabel,
  contractLinkPath,
  contractShare,
  controlNowLine,
  dealsRangeLabel,
  hiddenTiesLine,
  linkPeriod,
  linkSentence,
  linkShare,
  orderedPeople,
  otherBuyerCount,
  personOfficeLine,
  personOfficeLines,
  personRoleLine,
  polishList,
  strengthReason,
  unlistedBuyersLine,
} from "../../app/utils/contractLinks";
import {
  CONTRACT_LINK_ID_PATTERN,
  contractLinkAmountRange,
  contractLinkDealsRange,
  type ContractLinkPerson,
  type ContractLinkRow,
} from "../../shared/contractLinks";
import type { ContractParty } from "../../shared/contracts";

function person(
  overrides: Partial<ContractLinkPerson> = {},
): ContractLinkPerson {
  return {
    name: "Jan Testowy",
    kind: "politician",
    roles: ["prezes zarządu"],
    controlNow: true,
    candidacies: [],
    wonYears: [],
    inOfficeNow: false,
    committees: [],
    ...overrides,
  };
}

function link(overrides: Partial<ContractLinkRow> = {}): ContractLinkRow {
  return {
    id: "cru_9990000011",
    locked: false,
    nip: "9990000011",
    krs: [],
    company: "BUDTEST SP. Z O.O.",
    status: "verified",
    strength: "A",
    visibility: "public",
    rank: 1,
    inOfficeNow: true,
    controlNow: true,
    people: [person()],
    ties: [],
    total: 1_180_000,
    ownAreaTotal: 1_180_000,
    firmTotal: 1_815_000,
    firmContracts: 5,
    deals: 1,
    basis: "own_territory",
    buyers: [
      { name: "GMINA TESTOWO", value: 1_180_000, contracts: 1, ownArea: true },
    ],
    buyerCount: 1,
    place: { wojewodztwo: "opolskie" },
    contractIds: [],
    flags: [],
    hook: "mandat w radzie gminy",
    updatedAt: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

describe("polishList", () => {
  it("joins with commas and a final „i”", () => {
    expect(polishList([2014])).toBe("2014");
    expect(polishList([2014, 2018])).toBe("2014 i 2018");
    expect(polishList([2014, 2018, 2024])).toBe("2014, 2018 i 2024");
  });
});

describe("personOfficeLine", () => {
  it("names the office and the years it was won", () => {
    expect(
      personOfficeLine(
        person({
          candidacies: [
            { year: 2014, office: "rada powiatu testowskiego", result: "won" },
            { year: 2018, office: "rada powiatu testowskiego", result: "won" },
            { year: 2010, office: "rada gminy Wzorcowo", result: "won" },
          ],
        }),
      ),
    ).toBe(
      "rada powiatu testowskiego — mandat: 2014 i 2018; rada gminy Wzorcowo — mandat: 2010",
    );
  });

  it("says a candidacy without a mandate is one, with no gendered verb", () => {
    const line = personOfficeLine(
      person({
        candidacies: [
          { year: 1998, office: "rada gminy Przykładowo", result: "lost" },
          { year: 2002, office: "rada gminy Przykładowo", result: "lost" },
        ],
      }),
    );
    expect(line).toBe(
      "rada gminy Przykładowo — kandydatura bez mandatu: 1998 i 2002",
    );
    expect(line).not.toMatch(/kandydował/);
  });

  it("never turns an unknown result into „bez mandatu”", () => {
    // „n/a" in PKW's data: a candidacy whose result it did not record.
    expect(
      personOfficeLine(
        person({
          candidacies: [
            { year: 2014, office: "wójt Wzorcowo", result: "unknown" },
          ],
        }),
      ),
    ).toBe("wójt Wzorcowo — kandydatura, wynik nieznany: 2014");
    expect(
      personOfficeLine(
        person({
          candidacies: [
            { year: 1998, office: "rada gminy Przykładowo", result: "lost" },
            { year: 2002, office: "rada gminy Przykładowo", result: "unknown" },
          ],
        }),
      ),
    ).toBe(
      "rada gminy Przykładowo — kandydatura bez mandatu: 1998; wynik nieznany: 2002",
    );
  });

  it("falls back to the years won when there are no candidacies", () => {
    expect(personOfficeLine(person({ wonYears: [1998, 2002] }))).toBe(
      "mandat: 1998 i 2002",
    );
  });

  it("prefers the office the research wrote for an official", () => {
    expect(
      personOfficeLine(
        person({
          kind: "official",
          office: "radna miasta Testowo 2024-2029",
        }),
      ),
    ).toBe("radna miasta Testowo 2024-2029");
  });
});

describe("personOfficeLines", () => {
  it("lists every office with won, lost and unknown years apart", () => {
    expect(
      personOfficeLines(
        person({
          candidacies: [
            {
              year: 1998,
              office: "rada powiatu testowskiego",
              result: "unknown",
            },
            { year: 2002, office: "rada gminy Wzorcowo", result: "won" },
            { year: 2006, office: "rada gminy Wzorcowo", result: "unknown" },
            { year: 2010, office: "rada gminy Wzorcowo", result: "won" },
            { year: 2014, office: "rada gminy Wzorcowo", result: "lost" },
          ],
          officeNote: "wicestarosta testowski od 2024 r.",
        }),
      ),
    ).toEqual([
      "rada gminy Wzorcowo: mandat 2002 i 2010; bez mandatu 2014; wynik nieznany 2006",
      "rada powiatu testowskiego: wynik nieznany 1998",
      "wicestarosta testowski od 2024 r.",
    ]);
  });

  it("gives a secondary person with no candidacies the years they won", () => {
    // The second person on somebody else's card: wonYears [1998, 2002],
    // candidacies [].
    expect(personOfficeLines(person({ wonYears: [1998, 2002] }))).toEqual([
      "mandat: 1998 i 2002",
    ]);
    expect(personOfficeLines(person())).toEqual([]);
  });
});

describe("personRoleLine", () => {
  it("adds the share and the whole date control ended", () => {
    expect(
      personRoleLine(
        person({
          roles: ["udziałowiec"],
          sharePct: 33,
          controlNow: false,
          controlUntil: "2025-11-21",
        }),
      ),
    ).toBe("udziałowiec · 33% udziałów · do 21 listopada 2025 r.");
    expect(personRoleLine(person({ controlNow: false }))).toBe(
      "prezes zarządu · w przeszłości",
    );
  });

  it("prints as much of a date as there is", () => {
    const until = (controlUntil: string) =>
      personRoleLine(person({ roles: [], controlNow: false, controlUntil }));
    expect(until("2021-03")).toBe("do marca 2021 r.");
    expect(until("2021")).toBe("do 2021 r.");
  });

  it("adds when control began, where asked to", () => {
    expect(
      personRoleLine(
        person({
          controlNow: false,
          controlSince: "2020-02-03",
          controlUntil: "2021-06-30",
        }),
        true,
      ),
    ).toBe("prezes zarządu · od 3 lutego 2020 r. do 30 czerwca 2021 r.");
    expect(personRoleLine(person({ controlSince: "2020-02-03" }), true)).toBe(
      "prezes zarządu · od 3 lutego 2020 r.",
    );
    expect(personRoleLine(person({ controlSince: "2020-02-03" }))).toBe(
      "prezes zarządu",
    );
  });
});

describe("orderedPeople", () => {
  it("puts whoever is in office today first and keeps the rest in order", () => {
    // An A finding whose research listed a councillor from 2002 first, and
    // the one in office today last.
    const people = [
      person({ name: "Jan Testowy" }),
      person({ name: "Anna Testowa" }),
      person({ name: "Ewa Przykładowa", inOfficeNow: true }),
    ];
    expect(orderedPeople(people).map((entry) => entry.name)).toEqual([
      "Ewa Przykładowa",
      "Jan Testowy",
      "Anna Testowa",
    ]);
    expect(people[0]!.name).toBe("Jan Testowy");
  });
});

/** `plnCompact` puts no-break spaces inside „2,7 mln zł”; compare the words. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("linkSentence and linkShare", () => {
  it("states the payer, the total and its share of the firm's register money", () => {
    expect(linkShare(link())).toBe(65);
    expect(plain(linkSentence(link()))).toBe(
      "Zamawiający: GMINA TESTOWO. Razem 1,2 mln zł — 65% tego, co firma dostała w rejestrze umów w tym okresie.",
    );
    expect(plain(linkSentence(link(), false))).toBe(
      "Razem 1,2 mln zł — 65% tego, co firma dostała w rejestrze umów w tym okresie.",
    );
  });

  it("declines the count of other payers", () => {
    const buyers = Array.from({ length: 6 }, (_, index) => ({
      name: `GMINA ${index}`,
      value: 1000,
      contracts: 1,
      ownArea: true,
    }));
    expect(linkSentence(link({ buyers: buyers.slice(0, 2) }))).toContain(
      "i 1 inna jednostka",
    );
    expect(linkSentence(link({ buyers: buyers.slice(0, 3) }))).toContain(
      "i 2 inne jednostki",
    );
    expect(linkSentence(link({ buyers, buyerCount: 6 }))).toContain(
      "i 5 innych jednostek",
    );
  });

  it("counts the payers from buyerCount, not from the twelve listed", () => {
    // A firm with 45 payers, 12 of them listed.
    const buyers = Array.from({ length: 12 }, (_, index) => ({
      name: `JEDNOSTKA ${index}`,
      value: 1000,
      contracts: 1,
      ownArea: true,
    }));
    expect(otherBuyerCount({ buyers, buyerCount: 45 })).toBe(44);
    expect(linkSentence(link({ buyers, buyerCount: 45 }))).toContain(
      "i 44 inne jednostki",
    );
    // A document from before `buyerCount`: the list is all there is.
    expect(
      otherBuyerCount({ buyers, buyerCount: undefined as unknown as number }),
    ).toBe(11);
  });

  it("says „wszystko” when the finding is the firm's whole register money", () => {
    expect(plain(linkSentence(link({ firmTotal: 1_180_000 }), false))).toBe(
      "Razem 1,2 mln zł — wszystko, co firma dostała w rejestrze umów w tym okresie.",
    );
  });
});

describe("unlistedBuyersLine", () => {
  const listed = [
    {
      name: "ZARZĄD DRÓG POWIATOWYCH W TESTOWIE",
      value: 13_000_000,
      contracts: 15,
      ownArea: true,
    },
  ];

  it("closes the payers list so it adds up to the total", () => {
    expect(
      plain(
        unlistedBuyersLine({
          buyers: listed,
          buyerCount: 24,
          total: 14_800_000,
          deals: 60,
        }),
      ),
    ).toBe("i jeszcze 23 jednostki — 1,8 mln zł (45 umów)");
    expect(
      plain(
        unlistedBuyersLine({
          buyers: listed,
          buyerCount: 2,
          total: 13_142_300,
          deals: 16,
        }),
      ),
    ).toBe("i jeszcze 1 jednostka — 142,3 tys. zł (1 umowa)");
  });

  it("leaves the money out when nothing is left over, and the line when nobody is", () => {
    expect(
      unlistedBuyersLine({
        buyers: listed,
        buyerCount: 6,
        total: 13_000_000,
        deals: 15,
      }),
    ).toBe("i jeszcze 5 jednostek");
    expect(
      unlistedBuyersLine({
        buyers: listed,
        buyerCount: 1,
        total: 14_000_000,
        deals: 20,
      }),
    ).toBe("");
  });
});

describe("amountRangeLabel and dealsRangeLabel", () => {
  it("print a teaser's band, never a figure", () => {
    const amount = (total: number) =>
      plain(amountRangeLabel(contractLinkAmountRange(total)));
    expect(amount(3_600)).toBe("2–5 tys. zł");
    expect(amount(1_400_000)).toBe("1–2 mln zł");
    expect(amount(740_000)).toBe("500 tys. – 1 mln zł");
    expect(amount(540)).toBe("poniżej 1 tys. zł");
    expect(amount(250_000_000)).toBe("100 mln zł i więcej");
  });

  it("decline the count of contracts by the figure beside the noun", () => {
    const deals = (count: number) =>
      dealsRangeLabel(contractLinkDealsRange(count));
    expect(deals(1)).toBe("1 umowa");
    expect(deals(3)).toBe("2–4 umowy");
    expect(deals(7)).toBe("5–9 umów");
    expect(deals(40)).toBe("10 i więcej umów");
  });
});

describe("hiddenTiesLine", () => {
  it("agrees the verb with the count", () => {
    expect(hiddenTiesLine(0)).toBe("");
    expect(hiddenTiesLine(1)).toBe(
      "Z firmą jest powiązana jeszcze jedna osoba — jej nazwisko widzą zalogowani.",
    );
    expect(hiddenTiesLine(3)).toBe(
      "Z firmą są powiązane jeszcze 3 osoby — ich nazwiska widzą zalogowani.",
    );
    expect(hiddenTiesLine(5)).toBe(
      "Z firmą jest powiązanych jeszcze 5 osób — ich nazwiska widzą zalogowani.",
    );
  });
});

describe("controlNowLine", () => {
  it("names who holds the firm today by role, never by name", () => {
    const line = controlNowLine(
      link({
        flags: ["control_through_tie"],
        ties: [
          {
            name: "Monika Testowa",
            tie: "wspólniczka",
            family: "siostra",
            confirmed: true,
          },
          { name: "Adam Testowy", tie: "prokurent", confirmed: false },
        ],
      }),
    );
    expect(line).toBe("dziś w firmie: wspólniczka (siostra)");
    expect(line).not.toContain("Monika");
  });

  it("falls back to the flag's words without ties, and says nothing without the flag", () => {
    expect(controlNowLine(link({ flags: ["control_through_tie"] }))).toBe(
      "Dziś firmę kontrolują powiązane osoby",
    );
    expect(controlNowLine(link())).toBe("");
  });
});

describe("contractShare", () => {
  const supplier = (name: string): ContractParty => ({
    role: "supplier",
    kind: "firma",
    name,
  });

  it("splits a shared contract equally, as the finding's totals do", () => {
    // Half of a contract with two suppliers.
    expect(
      contractShare({
        value: 2_400_000,
        suppliers: [supplier("BUDTEST"), supplier("INNA")],
      }),
    ).toEqual({ share: 1_200_000, whole: 2_400_000, suppliers: 2 });
  });

  it("is null for a contract held alone or with no stated value", () => {
    expect(
      contractShare({ value: 4_000, suppliers: [supplier("BUDTEST")] }),
    ).toBeNull();
    expect(
      contractShare({
        value: undefined,
        suppliers: [supplier("A"), supplier("B")],
      }),
    ).toBeNull();
  });
});

describe("contractLinkPath", () => {
  it("points the list at one finding, by an id the endpoint takes", () => {
    expect(contractLinkPath("cru_9990000011")).toBe(
      "/eksploruj/umowy?powiazanie=cru_9990000011",
    );
    expect(CONTRACT_LINK_ID_PATTERN.test("ukryte_12")).toBe(true);
    expect(contractLinkPath("ukryte_12")).toBe(
      "/eksploruj/umowy?powiazanie=ukryte_12",
    );
  });
});

describe("linkPeriod", () => {
  it("prints one month or a range of months", () => {
    expect(linkPeriod("2026-09-11", "2026-09-11")).toMatch(/wrz.* 2026/);
    expect(linkPeriod("2026-07-01", "2026-09-22")).toMatch(/lip.*–.*wrz/);
    expect(linkPeriod()).toBe("");
  });
});

describe("strengthReason", () => {
  it("says nothing for the strong classes, whose label already explains them", () => {
    expect(strengthReason(link({ strength: "A" }))).toBe("");
    expect(strengthReason(link({ strength: "B" }))).toBe("");
  });

  it("names what weakens a C or D finding", () => {
    expect(strengthReason(link({ strength: "C", controlNow: false }))).toBe(
      "kontrola w przeszłości",
    );
    const elsewhere = [
      { name: "GMINA WZORCOWO", value: 1_000, contracts: 1, ownArea: false },
    ];
    expect(
      strengthReason(
        link({
          strength: "C",
          flags: ["payer_outside_territory"],
          buyers: elsewhere,
        }),
      ),
    ).toBe("płatnik z innego terenu");
    expect(
      strengthReason(
        link({ strength: "D", flags: ["never_elected", "former_control"] }),
      ),
    ).toBe("kandydatura bez mandatu");
    expect(
      strengthReason(
        link({ strength: "D", people: [person({ wonYears: [1998, 2002] })] }),
      ),
    ).toBe("ostatni mandat w 2002 r.");
    expect(strengthReason(link({ strength: "D" }))).toBe("słabsze powiązanie");
  });

  it("calls the payer foreign only when the biggest one is", () => {
    // The flag is about the firm's money: under a fifth of it from where the
    // person stood, while every payer this finding counts may be local.
    for (const buyers of [link().buyers, []]) {
      expect(
        strengthReason(
          link({ strength: "D", flags: ["payer_outside_territory"], buyers }),
        ),
      ).toBe("mało pieniędzy z terenu mandatu");
    }
  });

  it("does not call a mandate the last when PKW does not know what came after", () => {
    expect(
      strengthReason(
        link({
          strength: "D",
          people: [
            person({
              wonYears: [2002],
              candidacies: [
                { year: 2002, office: "rada gminy Wzorcowo", result: "won" },
                {
                  year: 2006,
                  office: "rada gminy Wzorcowo",
                  result: "unknown",
                },
                { year: 2010, office: "rada gminy Wzorcowo", result: "lost" },
              ],
            }),
          ],
        }),
      ),
    ).toBe("ostatni znany mandat w 2002 r.");
    // An unknown result before the win changes nothing.
    expect(
      strengthReason(
        link({
          strength: "D",
          people: [
            person({
              wonYears: [2002],
              candidacies: [
                {
                  year: 1998,
                  office: "rada gminy Wzorcowo",
                  result: "unknown",
                },
                { year: 2002, office: "rada gminy Wzorcowo", result: "won" },
              ],
            }),
          ],
        }),
      ),
    ).toBe("ostatni mandat w 2002 r.");
  });
});

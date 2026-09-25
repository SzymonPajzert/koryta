import { describe, expect, it } from "vitest";
import {
  CONTRACT_LINK_FLAG_LABELS,
  CONTRACT_LINK_STRENGTH_LABELS,
  CONTRACT_LINK_UNCONFIRMED_HOOK,
  candidacyOffices,
  contractLinkAmountRange,
  contractLinkDealsRange,
  contractLinkDocumentId,
  officeHook,
  officeKind,
  type ContractLinkPerson,
} from "../../shared/contractLinks";

function person(
  overrides: Partial<ContractLinkPerson> = {},
): ContractLinkPerson {
  return {
    name: "Jan Testowy",
    kind: "politician",
    roles: [],
    controlNow: true,
    candidacies: [],
    wonYears: [],
    inOfficeNow: false,
    committees: [],
    ...overrides,
  };
}

describe("contractLinkDocumentId", () => {
  it("keys a finding on the supplier's NIP, digits only", () => {
    expect(contractLinkDocumentId("999-000-00-11")).toBe("cru_9990000011");
  });
});

describe("candidacyOffices", () => {
  it("groups by office, puts won offices first and the newest ahead", () => {
    expect(
      candidacyOffices([
        { year: 1998, office: "rada gminy Wzorcowo", result: "lost" },
        { year: 2002, office: "rada gminy Wzorcowo", result: "won" },
        { year: 2014, office: "rada powiatu testowskiego", result: "won" },
        { year: 2024, office: "rada powiatu testowskiego", result: "won" },
        { year: 2018, office: "burmistrz Wzorcowa", result: "lost" },
      ]),
    ).toEqual([
      {
        office: "rada powiatu testowskiego",
        won: [2014, 2024],
        lost: [],
        unknown: [],
      },
      { office: "rada gminy Wzorcowo", won: [2002], lost: [1998], unknown: [] },
      { office: "burmistrz Wzorcowa", won: [], lost: [2018], unknown: [] },
    ]);
  });

  it("keeps a result PKW left unknown apart from a lost one", () => {
    // „n/a" in 2006 between wins in 2002 and 2010 - very likely a mandate,
    // and certainly not a known loss.
    expect(
      candidacyOffices([
        { year: 2002, office: "rada gminy Wzorcowo", result: "won" },
        { year: 2006, office: "rada gminy Wzorcowo", result: "unknown" },
        { year: 2010, office: "rada gminy Wzorcowo", result: "won" },
      ]),
    ).toEqual([
      {
        office: "rada gminy Wzorcowo",
        won: [2002, 2010],
        lost: [],
        unknown: [2006],
      },
    ]);
  });
});

describe("officeHook", () => {
  it("says what the office is without saying where", () => {
    expect(
      officeHook(
        person({
          candidacies: [
            { year: 2024, office: "rada powiatu testowskiego", result: "won" },
            { year: 2010, office: "wójt Wzorcowo", result: "won" },
          ],
        }),
      ),
    ).toBe("mandat w radzie powiatu");
    expect(
      officeHook(
        person({
          candidacies: [{ year: 2024, office: "wójt Wzorcowo", result: "won" }],
        }),
      ),
    ).toBe("wójt");
  });

  it("names a council mandate by the seat, so it fits a woman as well", () => {
    // What the research wrote for a woman: a hook built from the person
    // („radny") would turn her into a man on every teaser.
    const hooks = [
      "radna gminy Przykładowo 2018-2024",
      "radny Rady Miejskiej w Testowie 2024-2029",
      "radna powiatu testowskiego 2010-2014",
      "radna sejmiku województwa opolskiego 2024-2029",
      "przewodnicząca Rady Gminy Przykładowo 2024-2029",
    ].map((office) => officeHook(person({ kind: "official", office })));
    expect(hooks).toEqual([
      "mandat w radzie gminy",
      "mandat w radzie gminy",
      "mandat w radzie powiatu",
      "mandat w sejmiku",
      "przewodnictwo rady gminy",
    ]);
    expect(
      officeHook(
        person({
          candidacies: [
            { year: 2018, office: "rada gminy Przykładowo", result: "won" },
          ],
        }),
      ),
    ).toBe("mandat w radzie gminy");
    for (const hook of hooks) {
      expect(hook).not.toMatch(/radn|przewodnicząc/);
    }
  });

  it("names a candidacy without a mandate as one, in a word that fits anyone", () => {
    expect(
      officeHook(
        person({
          candidacies: [
            { year: 2014, office: "rada gminy Przykładowo", result: "lost" },
          ],
        }),
      ),
    ).toBe("kandydatura do rady gminy");
    expect(
      officeHook(
        person({
          candidacies: [
            { year: 2018, office: "wójt Wzorcowo", result: "lost" },
          ],
        }),
      ),
    ).toBe("kandydatura na wójta");
  });

  it("says no more than „kandydatura” when PKW does not know the result", () => {
    const hook = officeHook(
      person({
        candidacies: [
          {
            year: 2014,
            office: "rada powiatu testowskiego",
            result: "unknown",
          },
        ],
      }),
    );
    expect(hook).toBe("kandydatura do rady powiatu");
    expect(hook).not.toMatch(/bez mandatu|kandydat\b/);
  });

  it("calls somebody with won years but no candidacies an office holder", () => {
    // A secondary person: the pipeline carries the years they won, not the
    // candidacies behind them.
    expect(officeHook(person({ wonYears: [1998, 2002] }))).toBe(
      "osoba z mandatem",
    );
    // Won somewhere, stood without a mandate here: the office stood for is
    // not the one won.
    expect(
      officeHook(
        person({
          wonYears: [2010],
          candidacies: [
            { year: 2014, office: "rada gminy Przykładowo", result: "lost" },
          ],
        }),
      ),
    ).toBe("osoba z mandatem");
  });

  it("reads an office the research wrote for an official", () => {
    expect(
      officeHook(
        person({ kind: "official", office: "wicestarosta testowski" }),
      ),
    ).toBe("wicestarosta");
    expect(
      officeHook(
        person({
          kind: "official",
          office: "pracownica Urzędu Gminy Testowo (inwestycje)",
        }),
      ),
    ).toBe("praca w urzędzie");
    expect(officeHook(person({ kind: "official" }))).toBe("osoba z władz");
  });

  it("never lets a place through", () => {
    const offices = [
      "rada gminy Przykładowo",
      "rada powiatu testowskiego",
      "wójt Wzorcowo",
      "burmistrz Testowo",
      "prezydent Wzorcowo",
      "sejmik województwa opolskiego",
      "wicestarosta testowski od 2024 r.",
    ];
    for (const office of offices) {
      const kind = officeKind(office);
      const hook = officeHook(person({ kind: "official", office }));
      expect(kind).not.toBe("");
      for (const word of office.split(" ").slice(1)) {
        if (!/^(rada|gminy|powiatu|województwa|od|r\.|\d+)$/.test(word)) {
          expect(kind).not.toContain(word);
          expect(hook).not.toContain(word);
        }
      }
    }
  });

  it("leaves a namesake's hook to a constant that claims no office", () => {
    expect(CONTRACT_LINK_UNCONFIRMED_HOOK).toBe("możliwa zbieżność nazwisk");
    expect(officeKind(CONTRACT_LINK_UNCONFIRMED_HOOK)).toBe("");
  });
});

describe("the class and flag labels", () => {
  it("fit a woman as well as a man", () => {
    // 51 findings lead with a woman. Present tense, „ta osoba" and nouns; no
    // past-tense verb or pronoun that settles the gender.
    // `\p{L}` rather than `\b`, which ends a word at „ł".
    const masculine =
      /(?<!\p{L})(jego|nim|mu|wygrał|kontrolował|kandydował|urzędujący|były radny)(?!\p{L})/iu;
    for (const label of Object.values(CONTRACT_LINK_STRENGTH_LABELS)) {
      expect(label.short).not.toMatch(masculine);
      expect(label.long).not.toMatch(masculine);
    }
    for (const label of Object.values(CONTRACT_LINK_FLAG_LABELS)) {
      expect(label).not.toMatch(masculine);
    }
  });

  it("do not say „jego samorząd” of a payer that is only on the same territory", () => {
    // A radny powiatu paid by a town inside that powiat.
    expect(CONTRACT_LINK_STRENGTH_LABELS.A.short).toBe(
      "Urzęduje dziś, płaci samorząd z terenu mandatu",
    );
  });

  it("claim no more than the rule that sets the flag", () => {
    // never_elected: no won result. One lost and one unknown is not „two
    // without a mandate" - PKW's „n/a" is not a lost election.
    expect(CONTRACT_LINK_FLAG_LABELS.never_elected).toBe(
      "Żadnego mandatu w wynikach PKW",
    );
    expect(CONTRACT_LINK_FLAG_LABELS.never_elected).not.toMatch(/\d|dwie/);
    // The firm's money, under a fifth from where the person stood - not this
    // finding's, which may all be local.
    expect(CONTRACT_LINK_FLAG_LABELS.payer_outside_territory).toContain(
      "piąta część pieniędzy firmy",
    );
    // Not every unconfirmed tie is a relative's, and one contract or many.
    expect(CONTRACT_LINK_FLAG_LABELS.tie_unconfirmed).not.toMatch(
      /pokrewie|rodzin/i,
    );
    expect(CONTRACT_LINK_FLAG_LABELS.direction_unclear).not.toMatch(/jednej/);
  });
});

describe("contractLinkAmountRange and contractLinkDealsRange", () => {
  it("round a teaser's figures to bands", () => {
    expect(contractLinkAmountRange(3_600)).toEqual([2_000, 5_000]);
    expect(contractLinkAmountRange(540)).toEqual([0, 1_000]);
    expect(contractLinkAmountRange(1_000_000)).toEqual([1_000_000, 2_000_000]);
    expect(contractLinkAmountRange(250_000_000)).toEqual([
      100_000_000, 100_000_000,
    ]);
    expect(contractLinkDealsRange(1)).toEqual([1, 1]);
    expect(contractLinkDealsRange(4)).toEqual([2, 4]);
    expect(contractLinkDealsRange(9)).toEqual([5, 9]);
    expect(contractLinkDealsRange(40)).toEqual([10, null]);
  });
});

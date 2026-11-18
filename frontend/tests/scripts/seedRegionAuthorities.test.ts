import { describe, it, expect } from "vitest";
import {
  filingTargets,
  indexRuns,
  matchPerson,
  recordFor,
  sameRecord,
  type SeedRecord,
  type WonRun,
} from "../../scripts/migrate/seed-region-authorities";

/** Won 2024 runs as the site stores them: a gmina's on its powiat. */
const runs: WonRun[] = [
  {
    personId: "wolski",
    personName: "Jakub Wolski",
    birthDate: "1980-03-02",
    target: "teryt1005",
    committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
  },
  {
    personId: "siewiera",
    personName: "Mariusz Jan Siewiera",
    target: "teryt1005",
    committee: "KWW ŁOWICKIE.PL",
  },
  // Two pages of one name on one list: neither can be told for sure.
  {
    personId: "nowak-1",
    personName: "Piotr Nowak",
    target: "teryt1005",
    committee: "KKW KOALICJA OBYWATELSKA",
  },
  {
    personId: "nowak-2",
    personName: "Piotr Nowak",
    target: "teryt1005",
    committee: "KKW KOALICJA OBYWATELSKA",
  },
];
const index = indexRuns(runs);

describe("filingTargets", () => {
  it("looks for a gmina's or a district's runs on its powiat as well", () => {
    expect(filingTargets("teryt1005011")).toEqual([
      "teryt1005011",
      "teryt1005",
    ]);
    expect(filingTargets("teryt1061")).toEqual(["teryt1061"]);
    expect(filingTargets("teryt10")).toEqual(["teryt10"]);
  });
});

describe("matchPerson", () => {
  it("links a winner to the page whose won run on the same list names them", () => {
    expect(
      matchPerson(
        {
          name: "Jakub Wolski",
          committee: "KW Prawo i Sprawiedliwość",
          birthYear: 1980,
        },
        "teryt1005011",
        index,
      ),
    ).toBe("wolski");
    // The page writes a middle name PKW's record has too, or not at all.
    expect(
      matchPerson(
        { name: "Mariusz Siewiera", committee: "KWW ŁOWICKIE.PL" },
        "teryt1005011",
        index,
      ),
    ).toBe("siewiera");
  });

  it("links nobody on a birth year that contradicts, another list, or two pages", () => {
    expect(
      matchPerson(
        {
          name: "Jakub Wolski",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          birthYear: 1990,
        },
        "teryt1005011",
        index,
      ),
    ).toBeUndefined();
    expect(
      matchPerson(
        { name: "Jakub Wolski", committee: "KWW ŁOWICKIE.PL" },
        "teryt1005011",
        index,
      ),
    ).toBeUndefined();
    expect(
      matchPerson(
        { name: "Piotr Nowak", committee: "KKW KOALICJA OBYWATELSKA" },
        "teryt1005011",
        index,
      ),
    ).toBeUndefined();
    // And nobody in a powiat the run was not filed in.
    expect(
      matchPerson(
        { name: "Jakub Wolski", committee: "KW PRAWO I SPRAWIEDLIWOŚĆ" },
        "teryt1006011",
        index,
      ),
    ).toBeUndefined();
  });
});

describe("recordFor", () => {
  const seed: SeedRecord = {
    election: "local-2024",
    head: {
      office: "Burmistrz",
      name: "Mariusz Siewiera",
      firstName: "Mariusz",
      lastName: "Siewiera",
      committee: "KWW ŁOWICKIE.PL",
      member: "Prawo i Sprawiedliwość",
    },
    councils: [
      {
        office: "Rada miasta",
        seats: 21,
        members: [
          {
            name: "Jakub Wolski",
            firstName: "Jakub",
            lastName: "Wolski",
            birthYear: 1980,
            committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
            committeeParties: ["PiS"],
          },
          { name: "Hubert Krajewski", committee: "KWW ŁOWICKIE.PL" },
        ],
      },
    ],
  };

  it("stores what the page reads, the pages matched, and nothing a match read", () => {
    const { record, linked, named } = recordFor("teryt1005011", seed, index);
    expect(record).toEqual({
      election: "local-2024",
      head: {
        office: "Burmistrz",
        name: "Mariusz Siewiera",
        personId: "siewiera",
        committee: "KWW ŁOWICKIE.PL",
        member: "Prawo i Sprawiedliwość",
      },
      councils: [
        {
          office: "Rada miasta",
          seats: 21,
          members: [
            {
              name: "Jakub Wolski",
              personId: "wolski",
              committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
              committeeParties: ["PiS"],
            },
            { name: "Hubert Krajewski", committee: "KWW ŁOWICKIE.PL" },
          ],
        },
      ],
    });
    expect({ linked, named }).toEqual({ linked: 2, named: 3 });
  });

  it("reads a stored record as the same however its keys are ordered", () => {
    const { record } = recordFor("teryt1005011", seed, index);
    const reordered = JSON.parse(
      JSON.stringify(record, Object.keys(record).reverse()),
    );
    expect(sameRecord({ ...reordered, ...record }, record)).toBe(true);
    expect(sameRecord({ ...record, election: "local-2018" }, record)).toBe(
      false,
    );
  });
});

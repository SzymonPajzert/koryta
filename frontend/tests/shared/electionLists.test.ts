import { describe, it, expect } from "vitest";
import {
  committeeKey,
  groupElectionLists,
  listKey,
  personRunsIn,
  regionKind,
  type RegionRun,
} from "../../shared/electionLists";

/** A run as the endpoint answers it, with what a test does not care about
 * filled in. */
function run(over: Partial<RegionRun> & { personId: string }): RegionRun {
  return {
    edgeId: `${over.personId}-${over.start ?? "2018"}-${over.position ?? ""}`,
    personName: over.personId,
    parties: [],
    published: true,
    start: "2018-01-01",
    position: "Rada powiatu",
    committee: null,
    party: null,
    elected: false,
    byElection: false,
    ...over,
  };
}

describe("committeeKey", () => {
  it("reads PKW's abbreviations, quotes and case as one committee", () => {
    // Powiat starachowicki: 2024's files abbreviate what 2018's spelled out,
    // and a council file and a mayoral file quote the same name differently.
    const one = committeeKey("KWW MARKA MATERKA 2024");
    expect(committeeKey("Komitet Wyborczy Wyborców Marka Materka 2024")).toBe(
      one,
    );
    expect(committeeKey("KWW „Nasz Powiat”")).toBe(
      committeeKey('KOMITET WYBORCZY WYBORCÓW "NASZ POWIAT"'),
    );
    expect(committeeKey("KKW KOALICJA OBYWATELSKA")).toBe(
      committeeKey("Koalicyjny Komitet Wyborczy Koalicja Obywatelska"),
    );
    // A hyphen run into its words, as 2024's „KW-TST-TWÓJ SAMORZĄD TERAZ”.
    expect(committeeKey("KW-TST-TWÓJ SAMORZĄD TERAZ")).toBe(
      "komitet wyborczy tst twój samorząd teraz",
    );
  });

  it("keeps two committees that differ by a word apart", () => {
    expect(committeeKey("KWW Nasza Gmina")).not.toBe(
      committeeKey("KWW Nasza Gmina Wąchock"),
    );
  });
});

describe("groupElectionLists", () => {
  const runs: RegionRun[] = [
    run({
      personId: "Jan Materek",
      start: "2024-01-01",
      position: "Prezydent",
      committee: "KWW MARKA MATERKA 2024",
      elected: true,
    }),
    // The mayor on his own council list too: one row, two offices.
    run({
      personId: "Jan Materek",
      start: "2024-01-01",
      position: "Rada powiatu",
      committee: "KWW MARKA MATERKA 2024",
    }),
    run({
      personId: "Anna Zając",
      start: "2024-01-01",
      position: "Rada miasta",
      committee: "Komitet Wyborczy Wyborców Marka Materka 2024",
    }),
    run({
      personId: "Piotr Adamski",
      start: "2024-01-01",
      committee: "KWW MARKA MATERKA 2024",
    }),
    run({
      personId: "Ewa Nowak",
      start: "2024-01-01",
      committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
    }),
    run({ personId: "Ewa Nowak", start: "2018-01-01", committee: null }),
    run({ personId: "Ewa Nowak", start: "2016-01-01", byElection: true }),
  ];
  const groups = groupElectionLists(runs);

  it("goes by election, newest first, and leaves a by-election off", () => {
    expect(groups.map((group) => group.election)).toEqual([
      "local-2024",
      "local-2018",
    ]);
    expect(groups[0]!.title).toBe("Samorządowe 2024");
  });

  it("puts a committee's candidates for every office on one list", () => {
    const [materka, pis] = groups[0]!.lists;
    expect(materka!.members.map((member) => member.personId)).toEqual([
      // Who won a seat first, then by surname.
      "Jan Materek",
      "Piotr Adamski",
      "Anna Zając",
    ]);
    expect(materka!.members[0]!.offices).toEqual(["Prezydent", "Rada powiatu"]);
    expect(materka!.offices).toEqual([
      { office: "Prezydent", count: 1 },
      { office: "Rada powiatu", count: 2 },
      { office: "Rada miasta", count: 1 },
    ]);
    expect(materka!.electedCount).toBe(1);
    // The spelling most of its runs use.
    expect(materka!.committee).toBe("KWW MARKA MATERKA 2024");
    expect(pis!.members.map((member) => member.personId)).toEqual([
      "Ewa Nowak",
    ]);
  });

  it("keeps the runs with no committee off every list", () => {
    expect(groups[1]!.lists).toEqual([]);
    expect(groups[1]!.unlisted.map((member) => member.personId)).toEqual([
      "Ewa Nowak",
    ]);
  });

  it("gives each list the key a link to it is built with", () => {
    expect(groups[0]!.lists[0]!.key).toBe(
      listKey("local-2024", "Komitet Wyborczy Wyborców Marka Materka 2024"),
    );
    expect(groups[0]!.lists[0]!.key).toBe(
      "local-2024--komitet-wyborczy-wyborcow-marka-materka-2024",
    );
  });

  it("lists one person's runs newest first, each with the list it was on", () => {
    const ewa = personRunsIn("Ewa Nowak", runs, groups);
    expect(ewa.map((each) => each.title)).toEqual([
      "Samorządowe 2024",
      "Samorządowe 2018",
      "Wybory uzupełniające 2016",
    ]);
    expect(ewa[0]!.list?.committee).toBe("KW PRAWO I SPRAWIEDLIWOŚĆ");
    expect(ewa[1]!.list).toBeNull();
    expect(ewa[2]!.list).toBeNull();
  });

  it("gives two runs on one list one row, each office with its result", () => {
    // Tomasz Budasz in Powiat gnieźnieński, 2018: prezydent and city council
    // on his own committee's list, two rows leading to the same list until
    // they were one.
    const jan = personRunsIn("Jan Materek", runs, groups);
    expect(jan).toHaveLength(1);
    expect(jan[0]!.offices).toEqual([
      { office: "Prezydent", elected: true },
      { office: "Rada powiatu", elected: false },
    ]);
    expect(jan[0]!.list?.members).toHaveLength(3);
  });
});

describe("regionKind", () => {
  it("reads the kind of place off the TERYT code's length", () => {
    expect(regionKind("14")).toBe("wojewodztwo");
    expect(regionKind("1005")).toBe("powiat");
    // 61 and up in a powiat's code: a city with powiat rights.
    expect(regionKind("1465")).toBe("miasto");
    expect(regionKind("1005011")).toBe("gmina");
    expect(regionKind(undefined)).toBeUndefined();
    expect(regionKind("teryt14")).toBeUndefined();
  });
});

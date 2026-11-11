import { describe, it, expect } from "vitest";
import {
  authorityKind,
  newestLocalElection,
  regionAuthorities,
} from "../../shared/regionAuthorities";
import type { RegionRun } from "../../shared/electionLists";

let edges = 0;
/** A 2024 win, with what a test does not care about filled in. */
function won(over: Partial<RegionRun> & { personId: string }): RegionRun {
  edges += 1;
  return {
    edgeId: `e${edges}`,
    personName: over.personId,
    parties: [],
    published: true,
    start: "2024-01-01",
    position: "Rada miasta",
    committee: null,
    party: null,
    elected: true,
    byElection: false,
    ...over,
  };
}

describe("authorityKind", () => {
  it("reads the kind of place off the TERYT code", () => {
    expect(authorityKind("10")).toBe("wojewodztwo");
    expect(authorityKind("1005")).toBe("powiat");
    expect(authorityKind("1061")).toBe("miasto");
    expect(authorityKind("1005011")).toBe("gmina");
    expect(authorityKind("1005072")).toBe("gmina");
    // A city's „Gmina X” node: governed by the city.
    expect(authorityKind("1061011")).toBe("twin");
    // A Warsaw district, though its powiat digits are a city's.
    expect(authorityKind("1465108")).toBe("dzielnica");
    // Miasto Warka, the town part of a mixed gmina, and a delegatura.
    expect(authorityKind("1406114")).toBe("part");
    expect(authorityKind("1261019")).toBeNull();
    expect(authorityKind(undefined)).toBeNull();
  });
});

describe("regionAuthorities", () => {
  it("reads the newest local election and its term", () => {
    expect(newestLocalElection()).toBe("local-2024");
    expect(regionAuthorities([], "1061")?.term).toBe("2024-2029");
  });

  const city: RegionRun[] = [
    won({
      personId: "Hanna Prezes",
      position: "Prezydent",
      committee: "KKW KOALICJA OBYWATELSKA",
      party: "PO",
    }),
    // The head also won a council seat, which passed down the list.
    won({
      personId: "Hanna Prezes",
      committee: "KKW KOALICJA OBYWATELSKA",
      party: "PO",
    }),
    won({
      personId: "Adam Zieliński",
      committee: "KKW KOALICJA OBYWATELSKA",
      party: "PO",
    }),
    won({ personId: "Ewa Abacka", committee: "KKW Koalicja Obywatelska" }),
    won({ personId: "Olga Nowa", committee: "KW PRAWO I SPRAWIEDLIWOŚĆ" }),
    won({ personId: "Jan Bez", committee: null }),
    // A loss, a win of the term before, a by-election and a run with no
    // office: none of them is the council now.
    won({
      personId: "Piotr Przegrany",
      committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
      elected: false,
    }),
    won({ personId: "Piotr Dawny", start: "2018-01-01" }),
    won({ personId: "Piotr Uzupełniony", byElection: true }),
    won({ personId: "Piotr Samorządowy", position: "Samorząd" }),
  ];

  it("names a city's prezydent and groups its council by committee", () => {
    const view = regionAuthorities(city, "1061")!;
    expect(view.kind).toBe("miasto");
    expect(view.title).toBe("Władze miasta");
    expect(view.executive).toMatchObject({
      state: "held",
      title: "Prezydent miasta",
      committee: "KKW KOALICJA OBYWATELSKA",
    });
    const [council] = view.councils;
    expect(council!.title).toBe("Rada miasta");
    expect(
      council!.committees.map((group) => [
        group.committee,
        group.party,
        group.members.map((member) => member.personId),
      ]),
    ).toEqual([
      // One committee in two spellings is one group, by surname.
      ["KKW KOALICJA OBYWATELSKA", "PO", ["Ewa Abacka", "Adam Zieliński"]],
      ["KW PRAWO I SPRAWIEDLIWOŚĆ", null, ["Olga Nowa"]],
      [null, null, ["Jan Bez"]],
    ]);
    expect(view.shown).toBe(5);
    expect(view.pointer).toBeUndefined();
  });

  it("counts a bare year as the term", () => {
    const view = regionAuthorities(
      [won({ personId: "Rok Bez Dnia", start: "2024" })],
      "1061",
    )!;
    expect(view.councils[0]!.shown).toBe(1);
  });

  it("keeps two pages of one name as two rows", () => {
    const view = regionAuthorities(
      [
        won({ personId: "a", personName: "Jan Kowalski", committee: "KWW X" }),
        won({ personId: "b", personName: "Jan Kowalski", committee: "KWW X" }),
      ],
      "1061",
    )!;
    expect(view.councils[0]!.committees[0]!.members).toHaveLength(2);
  });

  it("shows no head where two wins are stored for one seat", () => {
    const view = regionAuthorities(
      [
        ...city,
        won({
          personId: "Runner Up",
          position: "Prezydent",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
        }),
      ],
      "1061",
    )!;
    expect(view.executive).toMatchObject({ state: "contested" });
    expect(
      view.executive?.state === "contested" &&
        view.executive.holders.map((holder) => holder.personId),
    ).toEqual(["Hanna Prezes", "Runner Up"]);
    // Nobody is taken for the head, so the head's council seat counts.
    expect(view.councils[0]!.shown).toBe(5);
  });

  it("calls a win this reader may not see awaiting, and one beside it contested", () => {
    const council = city.filter((run) => run.position !== "Prezydent");
    expect(
      regionAuthorities(council, "1061", { Prezydent: 1 })!.executive,
    ).toMatchObject({ state: "awaiting", title: "Prezydent miasta" });
    expect(
      regionAuthorities(city, "1061", { Prezydent: 1 })!.executive,
    ).toMatchObject({ state: "contested" });
    expect(regionAuthorities(council, "1061")!.executive).toMatchObject({
      state: "unknown",
    });
  });

  it("gives a powiat and a województwo the head their council chooses", () => {
    const powiat = regionAuthorities(
      [
        won({
          personId: "Rafał Powiatowy",
          position: "Rada powiatu",
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
        }),
        // A gmina's wójt and council filed on the powiat are not its own.
        won({ personId: "Wójt Gminny", position: "Wójt" }),
        won({ personId: "Radny Gminny", position: "Rada gminy" }),
      ],
      "1005",
    )!;
    expect(powiat.executive).toEqual({ state: "appointed", title: "Starosta" });
    expect(powiat.councils.map((council) => council.title)).toEqual([
      "Rada powiatu",
    ]);
    expect(powiat.shown).toBe(1);
    const wojewodztwo = regionAuthorities(
      [won({ personId: "Radna Sejmiku", position: "Sejmik" })],
      "10",
    )!;
    expect(wojewodztwo.title).toBe("Władze województwa");
    expect(wojewodztwo.executive).toEqual({
      state: "appointed",
      title: "Marszałek województwa",
    });
    expect(wojewodztwo.councils[0]!.title).toBe("Sejmik województwa");
  });

  it("draws a gmina's head where a run names one, and its council by its kind", () => {
    const view = regionAuthorities(
      [won({ personId: "Andrzej Wójt", position: "Wójt", committee: "KWW Y" })],
      "2414052",
    )!;
    expect(view.executive).toMatchObject({ state: "held", title: "Wójt" });
    expect(
      view.councils.map((council) => [council.title, council.shown]),
    ).toEqual([["Rada gminy", 0]]);
    expect(view.pointer).toBeUndefined();
    // A town's council is its Rada miasta.
    expect(regionAuthorities([], "1005011")!.councils[0]!.title).toBe(
      "Rada miasta",
    );
  });

  it("points a place that shows nobody where its people are", () => {
    // A gmina: its runs are on its powiat for now.
    expect(regionAuthorities([], "1005011")).toMatchObject({
      shown: 0,
      pointer: "powiat",
    });
    // A city's gmina twin and a Warsaw district: on the city's page.
    expect(regionAuthorities([], "1061011")).toMatchObject({
      shown: 0,
      pointer: "miasto",
    });
    expect(regionAuthorities([], "1465108")).toMatchObject({
      kind: "dzielnica",
      pointer: "miasto",
    });
    // A powiat points nowhere: its line just says nobody is known.
    expect(regionAuthorities([], "1005")!.pointer).toBeUndefined();
    // A part of a gmina has no government of its own.
    expect(regionAuthorities([], "1406114")).toBeNull();
  });
});

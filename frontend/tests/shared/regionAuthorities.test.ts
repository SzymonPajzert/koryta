import { describe, it, expect } from "vitest";
import {
  authorityKind,
  committeeLabel,
  governmentSections,
  headTitle,
  newestLocalElection,
  termOf,
  type GovernmentPersonView,
  type GovernmentView,
} from "../../shared/regionAuthorities";

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

describe("the term", () => {
  it("is the newest local election's, five years", () => {
    expect(newestLocalElection()).toBe("local-2024");
    expect(termOf()).toBe("2024-2029");
    expect(termOf("local-2018")).toBe("2018-2023");
    expect(termOf("nonsense")).toBe("");
  });
});

function person(
  name: string,
  over: Partial<GovernmentPersonView> = {},
): GovernmentPersonView {
  return { name, committee: "KWW ŁOWICKIE.PL", ...over };
}

/** Gmina Łowicz as PKW left it: the burmistrz, and a council one of whose 21
 * seats passed to somebody PKW does not name. */
const lowicz: GovernmentView = {
  election: "local-2024",
  head: {
    ...person("Mariusz Siewiera"),
    office: "Burmistrz",
  },
  councils: [
    {
      office: "Rada miasta",
      seats: 4,
      members: [
        person("Jakub Wolski", {
          committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
          committeeParties: ["PiS"],
          page: { id: "p1", published: true, parties: ["PiS"] },
        }),
        person("Hubert Krajewski"),
        person("Adam Babski", {
          committee: "KW Prawo i Sprawiedliwość",
          committeeParties: ["PiS"],
        }),
      ],
    },
  ],
};

describe("governmentSections", () => {
  it("draws the head and each council, by committee, the largest first", () => {
    const sections = governmentSections(lowicz, "gmina")!;
    expect(sections.title).toBe("Władze gminy");
    expect(sections.term).toBe("2024-2029");
    expect(sections.head).toMatchObject({
      office: "Burmistrz",
      title: "Burmistrz",
      appointed: false,
      holder: { name: "Mariusz Siewiera" },
    });
    const [council] = sections.councils;
    expect(council).toMatchObject({
      title: "Rada miasta",
      seats: 4,
      unnamed: 1,
    });
    // One committee however PKW cased it, and its members by name.
    expect(
      council!.committees.map((group) => [
        group.committee,
        group.parties,
        group.members.map((member) => member.name),
      ]),
    ).toEqual([
      ["KW PRAWO I SPRAWIEDLIWOŚĆ", ["PiS"], ["Adam Babski", "Jakub Wolski"]],
      ["KWW ŁOWICKIE.PL", [], ["Hubert Krajewski"]],
    ]);
  });

  it("keeps the slot of a head the council chooses, nobody in it", () => {
    const powiat = governmentSections(
      {
        election: "local-2024",
        councils: [{ office: "Rada powiatu", members: [person("Anna Nowak")] }],
      },
      "powiat",
    )!;
    expect(powiat.head).toEqual({
      office: "Starosta",
      title: "Starosta",
      appointed: true,
    });
    expect(
      governmentSections({ councils: [] }, "wojewodztwo")!.head?.title,
    ).toBe("Marszałek województwa");
    // Filled in by somebody: the slot holds them.
    const filled = governmentSections(
      { councils: [], head: { office: "Starosta", name: "Jan Kowalski" } },
      "powiat",
    )!;
    expect(filled.head).toMatchObject({
      appointed: true,
      holder: { name: "Jan Kowalski" },
    });
  });

  it("names PKW's prezydent the way a reader does", () => {
    expect(headTitle("Prezydent")).toBe("Prezydent miasta");
    expect(
      governmentSections(
        {
          councils: [],
          head: { office: "Prezydent", name: "Hanna Zdanowska" },
        },
        "miasto",
      )!.head?.title,
    ).toBe("Prezydent miasta");
  });

  it("draws nothing for a place with no record and no slot to hold", () => {
    expect(governmentSections(null, "gmina")).toBeNull();
    expect(governmentSections(undefined, "miasto")).toBeNull();
  });
});

describe("committeeLabel", () => {
  it("names a party's list by the party, a local list by itself", () => {
    expect(committeeLabel("KKW KOALICJA OBYWATELSKA", ["PO"])).toBe("KO");
    expect(
      committeeLabel("KKW TRZECIA DROGA PSL-PL2050", ["PSL", "Polska 2050"]),
    ).toBe("Trzecia Droga");
    expect(committeeLabel("KW PRAWO I SPRAWIEDLIWOŚĆ", ["PiS"])).toBe("PiS");
    expect(committeeLabel("KWW ŁOWICKIE.PL", [])).toBe("KWW ŁOWICKIE.PL");
  });
});

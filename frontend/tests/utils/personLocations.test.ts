import { describe, it, expect } from "vitest";
import {
  electionsFromEdges,
  locationKinds,
  locationsCovering,
  personLocations,
  unplaceableLocations,
} from "~/utils/personLocations";

describe("electionsFromEdges", () => {
  it("reads the town, the year and the code off an election edge", () => {
    expect(
      electionsFromEdges([
        {
          type: "election",
          start_date: "2018-10-21",
          position: "Rada miasta",
          committee: "KWW Kraków",
          richNode: { name: "Kraków", teryt: "1261" },
        },
      ]),
    ).toEqual([
      {
        year: "2018",
        location: "Kraków",
        teryt: "1261",
        position: "Rada miasta",
        committee: "KWW Kraków",
      },
    ]);
  });

  it("ignores every relation that is not a candidacy", () => {
    expect(
      electionsFromEdges([
        { type: "employed", richNode: { name: "PKP Intercity" } },
        { type: "connection", richNode: { name: "Jan Kowalski" } },
      ]),
    ).toEqual([]);
  });

  it("drops a candidacy with no town to name", () => {
    expect(
      electionsFromEdges([{ type: "election", start_date: "2014-11-16" }]),
    ).toEqual([]);
  });

  it("puts the earliest campaign first", () => {
    const elections = electionsFromEdges([
      {
        type: "election",
        start_date: "2018-10-21",
        richNode: { name: "Sopot" },
      },
      {
        type: "election",
        start_date: "2010-11-21",
        richNode: { name: "Gdynia" },
      },
    ]);
    expect(elections.map((e) => e.location)).toEqual(["Gdynia", "Sopot"]);
  });

  it("falls back to the relation's own name, then to a bare Wybory", () => {
    const elections = electionsFromEdges([
      {
        type: "election",
        name: "Wybory do Sejmu",
        richNode: { name: "Gdańsk" },
      },
      { type: "election", richNode: { name: "Sopot" } },
    ]);
    expect(elections.map((e) => e.position)).toEqual([
      "Wybory do Sejmu",
      "Wybory",
    ]);
  });

  it("leaves the year and the code out where the edge has neither", () => {
    expect(
      electionsFromEdges([
        { type: "election", richNode: { name: "Zagranica" } },
      ]),
    ).toEqual([
      {
        year: undefined,
        location: "Zagranica",
        teryt: undefined,
        position: "Wybory",
        committee: undefined,
      },
    ]);
  });
});

describe("personLocations", () => {
  it("puts where they stood for election before where they work", () => {
    const locations = personLocations(
      [{ location: "Kraków", teryt: "1261" }],
      [{ name: "Województwo Pomorskie", teryt: "22" }],
    );
    expect(locations.map((l) => l.name)).toEqual([
      "Kraków",
      "Województwo Pomorskie",
    ]);
    expect(locations.map((l) => l.kinds)).toEqual([["election"], ["work"]]);
  });

  it("names a place once when it is both", () => {
    const locations = personLocations(
      [{ location: "Kraków", teryt: "1261" }],
      [{ name: "Kraków", teryt: "1261" }],
    );
    expect(locations).toHaveLength(1);
    expect(locations[0]!.kinds).toEqual(["election", "work"]);
  });

  it("matches on the name where one side has no code", () => {
    const locations = personLocations(
      [{ location: "Płock", teryt: "1462" }],
      [{ name: "Płock" }],
    );
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ teryt: "1462" });
  });

  it("keeps two places that share a name but not a code", () => {
    const locations = personLocations(
      [{ location: "Nowa Wieś", teryt: "1465011" }],
      [{ name: "Nowa Wieś", teryt: "0201032" }],
    );
    expect(locations).toHaveLength(2);
  });

  it("takes a code from whichever side has one", () => {
    const locations = personLocations(
      [{ location: "Sopot" }],
      [{ name: "Sopot", teryt: "2264" }],
    );
    expect(locations[0]).toMatchObject({ teryt: "2264", name: "Sopot" });
  });

  it("drops a place with no name to show", () => {
    expect(personLocations([{ teryt: "1261" }], [])).toEqual([]);
  });
});

describe("locationsCovering", () => {
  const locations = personLocations(
    [{ location: "Kraków", teryt: "1261" }],
    [{ name: "Województwo Pomorskie", teryt: "22" }, { name: "Bez kodu" }],
  );

  it("colours the powiat a gmina and a powiat name", () => {
    expect(locationsCovering(locations, "1261").map((l) => l.name)).toEqual([
      "Kraków",
    ]);
  });

  it("colours every powiat a województwo contains", () => {
    expect(locationsCovering(locations, "2261").map((l) => l.name)).toEqual([
      "Województwo Pomorskie",
    ]);
  });

  it("colours nothing elsewhere, and never for a place without a code", () => {
    expect(locationsCovering(locations, "0201")).toEqual([]);
  });
});

describe("locationKinds", () => {
  it("lists wybory before praca, once each", () => {
    const locations = personLocations(
      [{ location: "Kraków", teryt: "1261" }],
      [
        { name: "Kraków", teryt: "1261" },
        { name: "Płock", teryt: "1462" },
      ],
    );
    expect(locationKinds(locations)).toEqual(["election", "work"]);
    expect(locationKinds([])).toEqual([]);
  });
});

describe("unplaceableLocations", () => {
  it("is the places no code ever reached", () => {
    const locations = personLocations(
      [{ location: "Kraków", teryt: "1261" }, { location: "Zagranica" }],
      [],
    );
    expect(unplaceableLocations(locations).map((l) => l.name)).toEqual([
      "Zagranica",
    ]);
  });
});

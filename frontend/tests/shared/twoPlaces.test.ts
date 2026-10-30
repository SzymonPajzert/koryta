import { describe, it, expect } from "vitest";
import {
  clashElection,
  electionStoodIn,
  placeClashes,
  placesAgree,
  regionTeryt,
  yearsInPlace,
  type Candidacy,
} from "../../shared/twoPlaces";

/** A candidacy of one person's unless told otherwise, with an id to read the
 * answers back by. */
function run(
  id: string,
  regionId: string,
  startDate: string | null,
  fields: Partial<Candidacy> = {},
) {
  return {
    id,
    personId: "kowalski",
    regionId,
    startDate,
    position: "Samorząd",
    ...fields,
  };
}

/** The clashes of a list, as election, offices and ids, so the assertions
 * read as the list. */
function clashes(rows: ReturnType<typeof run>[]) {
  return placeClashes(rows, (row) => row).map((clash) => ({
    election: `${clash.personId} ${clash.year} ${clash.election}`,
    offices: clash.offices,
    ids: clash.rows.map((row) => row.id),
  }));
}

describe("placeClashes", () => {
  it("finds two powiats in one election", () => {
    // Jacek Wojciech Kowalski, published on 2026-10-14 with both of these
    // live: powiat kozienicki (Mazowieckie) beside a career in powiat
    // gnieźnieński (Wielkopolskie).
    expect(
      clashes([
        run("gnieznienski-2002", "teryt3003", "2002-01-01"),
        run("kozienicki-2002", "teryt1407", "2002-01-01"),
        run("gnieznienski-2006", "teryt3003", "2006-01-01"),
      ]),
    ).toEqual([
      {
        election: "kowalski 2002 local",
        offices: ["Samorząd"],
        ids: ["gnieznienski-2002", "kozienicki-2002"],
      },
    ]);
  });

  it("finds the Senat in one województwo and the Sejm in another, one election", () => {
    // Łukasz Mikołajczyk on 2026-10-29: his 2015 Senat run in wielkopolskie
    // and a namesake's Sejm run in dolnośląskie, both drafts on his page,
    // which the office key filed apart. The two chambers are elected on one
    // day, and nobody stands for both.
    expect(
      clashes([
        run("senat", "teryt30", "2015-01-01", { position: "Senat" }),
        run("sejm", "teryt02", "2015-01-01", { position: "Sejm" }),
      ]),
    ).toEqual([
      {
        election: "kowalski 2015 parliament",
        offices: ["Senat", "Sejm"],
        ids: ["senat", "sejm"],
      },
    ]);
  });

  it("finds a sejmik run beside a city council run outside its województwo", () => {
    // Anna Majchrzak's 2024 Sejmik run under mazowieckie, and her Kutno
    // namesake's Rada miasta run under powiat kutnowski (łódzkie).
    expect(
      clashes([
        run("sejmik", "teryt14", "2024-01-01", { position: "Sejmik" }),
        run("kutno", "teryt1002", "2024-01-01", { position: "Rada miasta" }),
      ]),
    ).toEqual([
      {
        election: "kowalski 2024 local",
        offices: ["Sejmik", "Rada miasta"],
        ids: ["sejmik", "kutno"],
      },
    ]);
  });

  it("finds a city council run beside a district council run in another city", () => {
    // Kamil Klimek, a Suwałki councillor, and a namesake's 2024 run for a
    // Warsaw district's council, filed under Warszawa.
    expect(
      clashes([
        run("suwalki", "teryt2063", "2024-01-01", { position: "Rada miasta" }),
        run("warszawa", "teryt1465", "2024-01-01", {
          position: "Rada dzielnicy",
        }),
      ]),
    ).toEqual([
      {
        election: "kowalski 2024 local",
        offices: ["Rada miasta", "Rada dzielnicy"],
        ids: ["suwalki", "warszawa"],
      },
    ]);
  });

  it("reads a candidacy with no office by its year", () => {
    // 2010 held only the local election, so a run with no office is local,
    // and a „Samorząd” run in another województwo clashes with it: Tomasz
    // Wiśniewski and Paweł Stolarczyk, published, on the 2026-10-25 export.
    expect(
      clashes([
        run("brak", "teryt1407", "2010-01-01", { position: null }),
        run("samorzad", "teryt3003", "2010-01-01"),
      ]),
    ).toEqual([
      {
        election: "kowalski 2010 local",
        offices: ["Samorząd"],
        ids: ["brak", "samorzad"],
      },
    ]);
    // And 2005 held only the Sejm's and the Senat's.
    expect(
      clashes([
        run("brak", "teryt02", "2005-01-01", { position: null }),
        run("senat", "teryt30", "2005-01-01", { position: "Senat" }),
      ]).map((clash) => clash.election),
    ).toEqual(["kowalski 2005 parliament"]);
  });

  it("keeps a run with no office apart in a year of two elections", () => {
    // 2014 held the local and the european election: one with no office
    // could be either, so it does not meet a local run...
    expect(
      clashes([
        run("brak", "teryt1407", "2014-01-01", { position: null }),
        run("samorzad", "teryt3003", "2014-01-01"),
      ]),
    ).toEqual([]);
    // ...but two of them of one year make a group of their own, as in the
    // check, and their places can still disagree.
    expect(
      clashes([
        run("brak", "teryt1407", "2014-01-01", { position: null }),
        run("tez-brak", "teryt3003", "2014-01-01", { position: undefined }),
      ]),
    ).toEqual([
      {
        election: "kowalski 2014 null",
        offices: [],
        ids: ["brak", "tez-brak"],
      },
    ]);
  });

  it("lets a sejmik run stand beside a council run inside its województwo", () => {
    // 30 is Wielkopolskie and 3003 one of its powiats: one place at two
    // depths, which is how the sejmik and a powiat council are recorded.
    expect(
      clashes([
        run("sejmik", "teryt30", "2002-01-01"),
        run("powiat", "teryt3003", "2002-01-01"),
      ]),
    ).toEqual([]);
    // Whatever the offices say, as long as both are of one election.
    expect(
      clashes([
        run("sejmik", "teryt30", "2024-01-01", { position: "Sejmik" }),
        run("powiat", "teryt3003", "2024-01-01", { position: "Rada powiatu" }),
      ]),
    ).toEqual([]);
  });

  it("names every run a third place disagrees with", () => {
    // The sejmik and the powiat agree with each other, but neither with
    // powiat kozienicki - so none of the three can be left out of the warning.
    expect(
      clashes([
        run("sejmik", "teryt30", "2002-01-01"),
        run("powiat", "teryt3003", "2002-01-01"),
        run("obcy", "teryt1407", "2002-01-01"),
      ]),
    ).toEqual([
      {
        election: "kowalski 2002 local",
        offices: ["Samorząd"],
        ids: ["sejmik", "powiat", "obcy"],
      },
    ]);
  });

  it("keeps two runs in one place, which is two offices, not two places", () => {
    // A town council and its mayoralty in one year are stored as two
    // identical edges (see test_occurrence_edges_may_repeat).
    expect(
      clashes([
        run("rada", "teryt3003", "2002-01-01"),
        run("burmistrz", "teryt3003", "2002-01-01"),
      ]),
    ).toEqual([]);
  });

  it("reads different years and different kinds of election as different elections", () => {
    // 2024 held both the local and the european election.
    expect(
      clashes([
        run("2002", "teryt3003", "2002-01-01"),
        run("2006", "teryt1407", "2006-01-01"),
        run("samorzad", "teryt3003", "2024-04-07"),
        run("pe", "teryt14", "2024-06-09", {
          position: "Parlament Europejski",
        }),
      ]),
    ).toEqual([]);
  });

  it("groups by the year alone, whatever the day", () => {
    // Nearly every candidacy is dated to 1 January, a few to the election day.
    expect(
      clashes([
        run("styczen", "teryt3003", "2024-01-01"),
        run("kwiecien", "teryt1407", "2024-04-07"),
      ]).map((clash) => clash.ids),
    ).toEqual([["styczen", "kwiecien"]]);
  });

  it("reads an empty office as none, as the night's check does", () => {
    // `field(edge, "position")` there: None and "" both say nothing, and the
    // year says the rest.
    expect(
      clashes([
        run("brak", "teryt3003", "2002-01-01", { position: null }),
        run("pusty", "teryt1407", "2002-01-01", { position: "" }),
      ]),
    ).toEqual([
      { election: "kowalski 2002 local", offices: [], ids: ["brak", "pusty"] },
    ]);
  });

  it("keeps two people's runs apart", () => {
    expect(
      clashes([
        run("jego", "teryt3003", "2002-01-01"),
        run("czyjas", "teryt1407", "2002-01-01", { personId: "imiennik" }),
      ]),
    ).toEqual([]);
  });

  it("leaves out what it cannot place or date", () => {
    expect(
      clashes([
        run("jest", "teryt3003", "2002-01-01"),
        run("bez-daty", "teryt1407", null),
        run("nie-region", "AbCdEf", "2002-01-01"),
      ]),
    ).toEqual([]);
  });

  it("skips the rows the reader says are not candidacies", () => {
    const rows = [
      { kind: "election", id: "a", regionId: "teryt3003" },
      { kind: "employed", id: "b", regionId: "teryt1407" },
    ];
    expect(
      placeClashes(rows, (row) =>
        row.kind === "election"
          ? {
              personId: "kowalski",
              regionId: row.regionId,
              startDate: "2002-01-01",
            }
          : undefined,
      ),
    ).toEqual([]);
  });
});

describe("electionStoodIn", () => {
  const stood = (position: string | null | undefined, startDate = "2024") =>
    electionStoodIn({ position, startDate: `${startDate}-01-01` });

  it("reads a named office's kind of election", () => {
    expect(stood("Sejm", "2015")).toBe("parliament");
    expect(stood("Senat", "2015")).toBe("parliament");
    expect(stood("Parlament Europejski")).toBe("european");
    expect(stood("Rada dzielnicy")).toBe("local");
    expect(stood("Samorząd")).toBe("local");
  });

  it("reads a missing office by the year, where the year held one election", () => {
    expect(stood(null, "2018")).toBe("local");
    expect(stood("", "2010")).toBe("local");
    expect(stood(undefined, "2023")).toBe("parliament");
    expect(stood(null, "2009")).toBe("european");
  });

  it("says nothing where the year held two elections, or none", () => {
    expect(stood(null, "2014")).toBeNull();
    expect(stood(null, "2019")).toBeNull();
    expect(stood(null, "2024")).toBeNull();
    expect(stood(null, "2016")).toBeNull();
    expect(electionStoodIn({ position: null, startDate: null })).toBeNull();
  });
});

describe("clashElection", () => {
  it("names the year and each office the rows stood for", () => {
    expect(clashElection({ year: "2002", offices: ["Samorząd"] })).toBe(
      "2002 · Samorząd",
    );
    expect(clashElection({ year: "2015", offices: ["Senat", "Sejm"] })).toBe(
      "2015 · Senat i Sejm",
    );
    expect(
      clashElection({
        year: "2024",
        offices: ["Sejmik", "Rada miasta", "Rada dzielnicy"],
      }),
    ).toBe("2024 · Sejmik, Rada miasta i Rada dzielnicy");
  });

  it("names the year alone where no row has an office", () => {
    expect(clashElection({ year: "2014", offices: [] })).toBe("2014");
  });

  it("puts the caller's separator between the two", () => {
    expect(clashElection({ year: "2002", offices: ["Samorząd"] }, ", ")).toBe(
      "2002, Samorząd",
    );
  });
});

describe("regionTeryt", () => {
  it("reads the code off a region's id", () => {
    expect(regionTeryt("teryt1407")).toBe("1407");
    expect(regionTeryt("teryt02")).toBe("02");
    expect(regionTeryt("teryt1261011")).toBe("1261011");
  });

  it("answers null for anything else", () => {
    expect(regionTeryt("wBwMzbNx3Q7WjeX4Ddf6")).toBeNull();
    expect(regionTeryt("teryt")).toBeNull();
    expect(regionTeryt("xteryt14")).toBeNull();
  });
});

describe("placesAgree", () => {
  it("agrees on one place and on one inside the other, either way round", () => {
    expect(placesAgree("3003", "3003")).toBe(true);
    expect(placesAgree("30", "3003")).toBe(true);
    expect(placesAgree("3003", "30")).toBe(true);
  });

  it("disagrees on two places side by side", () => {
    expect(placesAgree("3003", "1407")).toBe(false);
    // Poznań, a city with powiat rights, is not inside powiat poznański.
    expect(placesAgree("3064", "3021")).toBe(false);
  });
});

describe("yearsInPlace", () => {
  it("lists the years a person stood in a place or one containing it", () => {
    const rows = [
      run("2002", "teryt3003", "2002-01-01"),
      run("2002-obcy", "teryt1407", "2002-01-01"),
      run("2018", "teryt3003", "2018-01-01"),
      run("2006", "teryt3003", "2006-01-01"),
      run("2006-drugi", "teryt3003", "2006-01-01"),
      run("sejmik-2010", "teryt30", "2010-01-01"),
      run("czyjas", "teryt3003", "2014-01-01", { personId: "imiennik" }),
    ];
    expect(yearsInPlace(rows, (row) => row, "kowalski", "teryt3003")).toEqual([
      "2002",
      "2006",
      "2010",
      "2018",
    ]);
    expect(yearsInPlace(rows, (row) => row, "kowalski", "teryt1407")).toEqual([
      "2002",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
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

/** The clashes of a list, as election and ids, so the assertions read as the
 * list. */
function clashes(rows: ReturnType<typeof run>[]) {
  return placeClashes(rows, (row) => row).map((clash) => ({
    election: `${clash.personId} ${clash.year} ${clash.position}`,
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
        election: "kowalski 2002 Samorząd",
        ids: ["gnieznienski-2002", "kozienicki-2002"],
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
        election: "kowalski 2002 Samorząd",
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

  it("reads different years and different offices as different elections", () => {
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

  it("keeps absent and empty offices apart, as the night's check does", () => {
    // `edge.get("position")` there: None and "" are two keys.
    expect(
      clashes([
        run("brak", "teryt3003", "2002-01-01", { position: null }),
        run("pusty", "teryt1407", "2002-01-01", { position: "" }),
      ]),
    ).toEqual([]);
    expect(
      clashes([
        run("brak", "teryt3003", "2002-01-01", { position: null }),
        run("tez-brak", "teryt1407", "2002-01-01", { position: undefined }),
      ]).map((clash) => clash.ids),
    ).toEqual([["brak", "tez-brak"]]);
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

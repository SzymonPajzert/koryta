import { describe, it, expect } from "vitest";
import {
  partiesOnlyFrom,
  placeClashes,
  placesAgree,
  regionTeryt,
  yearsInPlace,
  type Candidacy,
} from "../../shared/twoPlaces";
import type { Edge } from "../../shared/model";
import type { NodeRelation } from "../../server/api/edges/byNode.get";
import { clashingCandidacies } from "../../server/utils/declarationPublish";

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
    byElection: false,
    ...fields,
  };
}

/** The clashes of a list, as election and ids, so the assertions read as the
 * list. */
function clashes(rows: ReturnType<typeof run>[]) {
  return placeClashes(rows, (row) => row).map((clash) => ({
    election: `${clash.personId} ${clash.election}`,
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
        election: "kowalski local-2002",
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
        election: "kowalski local-2002",
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

  it("puts every office of one election in one group", () => {
    // Page 17p1pbAJ0ZBZqbUjDtOK, held for two places on the 2026-11-18
    // export: a gmina council run in powiat nowodworski and a run for the
    // śląskie sejmik, both in the 2024 local election.
    expect(
      clashes([
        run("gmina", "teryt1414", "2024-01-01", { position: "Rada gminy" }),
        run("sejmik", "teryt24", "2024-01-01", { position: "Sejmik" }),
        run("miasto", "teryt1465", "2018-01-01", { position: "Rada miasta" }),
      ]),
    ).toEqual([{ election: "kowalski local-2024", ids: ["gmina", "sejmik"] }]);
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

  it("reads an absent and an empty office alike", () => {
    // Neither names an office, and 2002 held the local election alone.
    expect(
      clashes([
        run("brak", "teryt3003", "2002-01-01", { position: null }),
        run("pusty", "teryt1407", "2002-01-01", { position: "" }),
        run("tez-brak", "teryt3003", "2002-01-01", { position: undefined }),
      ]).map((clash) => clash.ids),
    ).toEqual([["brak", "pusty", "tez-brak"]]);
  });

  it("files a run with no office under the election `candidacyElection` reads it as", () => {
    // The local one in 2024, the Sejm's in 2019. The night's check gives such
    // runs a group of their own instead.
    expect(
      clashes([
        run("brak", "teryt0801", "2024-01-01", { position: null }),
        run("gmina", "teryt1414", "2024-01-01", { position: "Rada gminy" }),
      ]).map((clash) => clash.ids),
    ).toEqual([["brak", "gmina"]]);
    expect(
      clashes([
        run("brak", "teryt0801", "2019-01-01", { position: null }),
        run("pe", "teryt14", "2019-01-01", {
          position: "Parlament Europejski",
        }),
      ]),
    ).toEqual([]);
  });

  it("leaves a by-election out, a contest of its own", () => {
    expect(
      clashes([
        run("gmina", "teryt1414", "2024-01-01", { position: "Rada gminy" }),
        run("uzupelniajace", "teryt0201", "2024-01-01", {
          position: "Rada gminy",
          byElection: true,
        }),
      ]),
    ).toEqual([]);
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
    // No local election was held in 2016: these are by-elections nobody
    // marked as such.
    expect(
      clashes([
        run("a", "teryt3003", "2016-01-01", { position: "Rada gminy" }),
        run("b", "teryt1407", "2016-01-01", { position: "Rada gminy" }),
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
              byElection: false,
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

/** The publication's hold reads the stored edges (`clashingCandidacies`), the
 * publish dialog the rows /api/edges/byNode makes of them. A page the hold
 * keeps back for two places has to reach the dialog with the same runs
 * marked, or one confirm publishes the namesake's. */
describe("the hold and the publish dialog", () => {
  const stored = (
    id: string,
    target: string,
    year: string,
    position: Edge["position"],
    fields: Partial<Edge> = {},
  ): { id: string; data: Edge } => ({
    id,
    data: {
      type: "election",
      source: "osoba",
      target,
      name: "kandydatura",
      start_date: `${year}-01-01`,
      position,
      ...fields,
    },
  });

  it("mark the same runs, and no by-election", () => {
    const edges = [
      stored("gmina-2024", "teryt1414", "2024", "Rada gminy"),
      stored("sejmik-2024", "teryt24", "2024", "Sejmik"),
      stored("miasto-2018", "teryt1465", "2018", "Rada miasta"),
      stored("pe-2024", "teryt12", "2024", "Parlament Europejski"),
      stored("uzupelniajace-2024", "teryt0201", "2024", "Rada gminy", {
        by_election: true,
      }),
    ];
    // The endpoint's fields, as byNode.get.ts maps an edge.
    const rows: Pick<
      NodeRelation,
      "id" | "otherId" | "startDate" | "position" | "byElection"
    >[] = edges.map(({ id, data }) => ({
      id,
      otherId: data.target,
      startDate: data.start_date ?? null,
      position: data.position ?? null,
      byElection: data.by_election === true,
    }));

    const held = [...clashingCandidacies("osoba", edges)].sort();
    const marked = placeClashes(rows, (row) => ({
      personId: "osoba",
      regionId: row.otherId,
      startDate: row.startDate,
      position: row.position,
      byElection: row.byElection,
    }))
      .flatMap((clash) => clash.rows.map((row) => row.id))
      .sort();

    expect(held).toEqual(["gmina-2024", "sejmik-2024"]);
    expect(marked).toEqual(held);
  });
});

describe("partiesOnlyFrom", () => {
  type Row = { id: string; parties?: string[]; doubtful: boolean };
  const rows: Row[] = [
    // The run in the declaration's place, ticked.
    { id: "own", parties: ["PO"], doubtful: false },
    // A namesake's run in the other place of the clash, left unticked.
    { id: "namesake", parties: ["PiS", "PSL"], doubtful: true },
    // Another election, in the person's own place: nothing doubts it.
    { id: "earlier", parties: ["PSL"], doubtful: false },
    // Not a candidacy.
    { id: "job", doubtful: true },
  ];
  const partiesOf = (row: Row) => row.parties;
  const doubtful = (row: Row) => row.doubtful;

  it("names a party only doubtful runs give the page", () => {
    expect(
      partiesOnlyFrom(["PO", "PiS", "PSL"], rows, partiesOf, doubtful),
    ).toEqual(["PiS"]);
  });

  it("leaves a party no candidacy names, which came from elsewhere", () => {
    expect(partiesOnlyFrom(["Razem"], rows, partiesOf, doubtful)).toEqual([]);
  });

  it("drops a party once one of its runs is no longer in doubt", () => {
    const ticked = rows.map((row) =>
      row.id === "namesake" ? { ...row, doubtful: false } : row,
    );
    expect(
      partiesOnlyFrom(["PO", "PiS", "PSL"], ticked, partiesOf, doubtful),
    ).toEqual([]);
  });

  it("names each party once, in the page's order", () => {
    const both: Row[] = [{ id: "a", parties: ["PSL", "PiS"], doubtful: true }];
    expect(
      partiesOnlyFrom(["PiS", "PSL", "PiS"], both, partiesOf, doubtful),
    ).toEqual(["PiS", "PSL"]);
  });
});

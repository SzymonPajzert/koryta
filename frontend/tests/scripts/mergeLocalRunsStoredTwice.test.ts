import { describe, it, expect } from "vitest";
import {
  bareFoldedSejmikRuns,
  planLocalRuns,
  readPkw,
  removalReason,
  type PkwRun,
} from "../../scripts/migrate/merge-local-runs-stored-twice";
import type {
  RunPlan,
  StoredEdge,
} from "../../scripts/migrate/fold-candidacies";

const TERYTS: Record<string, string> = {
  teryt10: "10",
  teryt1061: "1061",
  teryt1005: "1005",
  teryt1018: "1018",
  teryt24: "24",
  teryt2464: "2464",
};
const terytOf = (id: unknown) => TERYTS[String(id)];

const KKW = "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI";

/** Michał Jerzy Sobczak's 2024 sejmik run as the June upload filed it: as
 * „Samorząd”, under Łódź, where he lives - live since his page was published. */
function atHome(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "xoQqPmr06ziH4e2wUIlh",
    data: {
      source: "sobczak",
      target: "teryt1061",
      type: "election",
      name: "kandydatura",
      position: "Samorząd",
      start_date: "2024-01-01",
      published: true,
      ...fields,
    },
  };
}

/** The same run as the 09-12 upload stored it beside: under łódzkie, a draft,
 * which the 10-23 night named „Sejmik”. */
function sejmik(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "edge_sobczak_teryt10_election_9Ac6tu4PUt",
    data: {
      source: "sobczak",
      target: "teryt10",
      type: "election",
      name: "kandydatura",
      position: "Sejmik",
      start_date: "2024-01-01",
      committee: KKW,
      published: false,
      ...fields,
    },
  };
}

const SEJMIK_2024: PkwRun = {
  office: "Sejmik",
  year: "2024",
  teryt: "10",
  elected: false,
};

/** `null` for a person PKW has no record of. */
function plan(edges: StoredEdge[], runs: PkwRun[] | null = [SEJMIK_2024]) {
  return planLocalRuns(edges, terytOf, () => runs ?? undefined);
}

function only(edges: StoredEdge[], runs?: PkwRun[]): RunPlan {
  const { plans, skipped } = plan(edges, runs);
  expect(skipped).toEqual([]);
  expect(plans).toHaveLength(1);
  return plans[0]!;
}

describe("planLocalRuns", () => {
  it("moves the live „Samorząd” copy to the sejmik's województwo and names it", () => {
    const folded = only([atHome(), sejmik()]);

    expect(folded).toMatchObject({
      personId: "sobczak",
      office: "Sejmik",
      keep: "xoQqPmr06ziH4e2wUIlh",
      movedFrom: "teryt1061",
      placeId: "teryt10",
      published: true,
      remove: ["edge_sobczak_teryt10_election_9Ac6tu4PUt"],
      learns: { position: "Sejmik", committee: KKW },
    });
    expect(folded.data).toEqual({
      source: "sobczak",
      target: "teryt10",
      type: "election",
      name: "kandydatura",
      position: "Sejmik",
      start_date: "2024-01-01",
      committee: KKW,
    });
  });

  it("takes a „Samorząd” copy under a województwo for the sejmik's", () => {
    // What the 09-12 upload wrote, before the night named it.
    const folded = only([atHome(), sejmik({ position: "Samorząd" })]);

    expect(folded.keep).toBe("xoQqPmr06ziH4e2wUIlh");
    // Named by PKW's office, as neither copy said it.
    expect(folded.learns).toEqual({ committee: KKW, position: "Sejmik" });
  });

  it("keeps the named copy where it is live, and removes the „Samorząd” one", () => {
    const folded = only([atHome(), sejmik({ published: true })]);

    expect(folded).toMatchObject({
      keep: "edge_sobczak_teryt10_election_9Ac6tu4PUt",
      movedFrom: null,
      remove: ["xoQqPmr06ziH4e2wUIlh"],
      data: null,
    });
  });

  it("keeps the named copy where neither is live", () => {
    const folded = only([atHome({ published: false }), sejmik()]);

    expect(folded).toMatchObject({
      keep: "edge_sobczak_teryt10_election_9Ac6tu4PUt",
      remove: ["xoQqPmr06ziH4e2wUIlh"],
      data: null,
    });
  });

  it("folds a run-off row's leftover copy into the named one in its town", () => {
    // Two rows for one mayoral run, one named by a later send.
    const folded = only(
      [
        atHome({
          target: "teryt1005",
          start_date: "2018-01-01",
          published: false,
        }),
        {
          id: "burmistrz",
          data: {
            source: "sobczak",
            target: "teryt1005",
            type: "election",
            position: "Burmistrz",
            start_date: "2018-01-01",
            published: true,
          },
        },
      ],
      [{ office: "Burmistrz", year: "2018", teryt: "1005", elected: false }],
    );

    expect(folded).toMatchObject({
      keep: "burmistrz",
      remove: ["xoQqPmr06ziH4e2wUIlh"],
    });
  });

  it("leaves a „Samorząd” copy that may be a run PKW has not had named yet", () => {
    // Marcin Witko's shape: a council run and a mayoral one in one town, and
    // only the mayoral one named so far. The „Samorząd” copy is the council.
    const { plans, skipped } = plan(
      [
        atHome({ target: "teryt1005", start_date: "2018-01-01" }),
        {
          id: "burmistrz",
          data: {
            source: "sobczak",
            target: "teryt1005",
            type: "election",
            position: "Burmistrz",
            start_date: "2018-01-01",
          },
        },
      ],
      [
        { office: "Burmistrz", year: "2018", teryt: "1005", elected: false },
        { office: "Rada miasta", year: "2018", teryt: "1005", elected: false },
      ],
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "a run not yet named" }]);
  });

  it("leaves a person PKW has no record of", () => {
    const { plans, skipped } = plan([atHome(), sejmik()], null);

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "no PKW record" }]);
  });

  it("leaves a year whose run PKW names no office for", () => {
    const { plans, skipped } = plan(
      [atHome(), sejmik()],
      [{ ...SEJMIK_2024, office: "Samorząd" }],
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "PKW names no office" }]);
  });

  it("leaves more named copies than PKW has runs", () => {
    const { plans, skipped } = plan([
      atHome(),
      sejmik(),
      { ...sejmik(), id: "edge_sobczak_teryt10_election_second" },
    ]);

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([
      { reason: "more named copies than PKW runs" },
    ]);
  });

  it("leaves a „Samorząd” copy with no named copy in its place", () => {
    // Under another województwo's powiat: two places, a reviewer's.
    const { plans, skipped } = plan([
      atHome({ target: "teryt2464" }),
      sejmik(),
    ]);

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "no named copy in its place" }]);
  });

  it("leaves a copy saying the run was won where PKW says it was lost", () => {
    // The old pairing wrote wins onto lost runs
    // (clear-wins-written-onto-lost-mayoral-runs).
    const { plans, skipped } = plan([atHome({ elected: true }), sejmik()]);

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "won here, lost in PKW" }]);
  });

  it("folds a win PKW records too, onto the copy that says it", () => {
    const folded = only(
      [atHome({ elected: true }), sejmik({ elected: true })],
      [{ ...SEJMIK_2024, elected: true }],
    );

    expect(folded.keep).toBe("xoQqPmr06ziH4e2wUIlh");
    expect(folded.data).toMatchObject({ elected: true, position: "Sejmik" });
  });

  it("pairs a copy with the named run in its own town before the sejmik", () => {
    const council = {
      id: "rada",
      data: {
        source: "sobczak",
        target: "teryt1061",
        type: "election",
        position: "Rada miasta",
        start_date: "2024-01-01",
        published: true,
      },
    };
    const { plans } = plan(
      [atHome({ published: false }), council, sejmik({ published: true })],
      [
        SEJMIK_2024,
        { office: "Rada miasta", year: "2024", teryt: "1061", elected: false },
      ],
    );

    expect(plans).toMatchObject([
      { keep: "rada", remove: ["xoQqPmr06ziH4e2wUIlh"] },
    ]);
  });

  it("never teaches the named copy the office or the result of the „Samorząd” one", () => {
    const folded = only([
      atHome({ published: false, content: "Notatka recenzenta." }),
      sejmik({ published: true }),
    ]);

    expect(folded.learns).toEqual({ content: "Notatka recenzenta." });
  });

  it("leaves a draft kept that would learn something", () => {
    const { plans, skipped } = plan([
      atHome({ published: false, content: "Notatka recenzenta." }),
      sejmik(),
    ]);

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "draft would learn" }]);
  });

  it("reads a run with no office as local only in a year with no other election", () => {
    // 2018 held only the local one; 2024 the European one as well.
    const bare2018 = only(
      [
        atHome({
          position: undefined,
          start_date: "2018-01-01",
          target: "teryt1005",
        }),
        {
          id: "rada",
          data: {
            source: "sobczak",
            target: "teryt1005",
            type: "election",
            position: "Rada miasta",
            start_date: "2018-01-01",
            published: true,
          },
        },
      ],
      [{ office: "Rada miasta", year: "2018", teryt: "1005", elected: false }],
    );
    expect(bare2018.keep).toBe("rada");

    const bare2024 = plan([atHome({ position: undefined }), sejmik()]);
    expect(bare2024).toEqual({ plans: [], skipped: [] });
  });

  it("never touches a national run", () => {
    const { plans, skipped } = plan([
      atHome({ position: "Sejm", start_date: "2023-01-01" }),
      sejmik({ position: "Sejm", start_date: "2023-01-01" }),
    ]);

    expect(plans).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("finds nothing more once a run is folded", () => {
    const folded = only([atHome(), sejmik()]);
    const after: StoredEdge[] = [
      { id: folded.keep, data: { ...folded.data!, published: true } },
      { ...sejmik(), data: { ...sejmik().data, deleted: true } },
    ];

    expect(plan(after)).toEqual({ plans: [], skipped: [] });
  });

  it("says on the copy it removes which copy stays", () => {
    expect(removalReason(only([atHome(), sejmik()]))).toBe(
      "Duplikat: ta sama kandydatura (Sejmik, 2024) była zapisana dwa razy, " +
        "raz jako „Samorząd”, bez nazwy urzędu. " +
        "Zostaje powiązanie xoQqPmr06ziH4e2wUIlh.",
    );
  });
});

describe("a sejmik run whose copy in place has no office either", () => {
  // 16 runs on the first production run: a live copy at home with no office,
  // folded into a „Samorząd” copy under the województwo.
  const home = atHome({ position: undefined, start_date: "2018-01-01" });
  const place = sejmik({ position: "Samorząd", start_date: "2018-01-01" });
  const run: PkwRun = { ...SEJMIK_2024, year: "2018" };

  it("is named by the office PKW gives it", () => {
    const folded = only([home, place], [run]);

    expect(folded.keep).toBe("xoQqPmr06ziH4e2wUIlh");
    expect(folded.data).toMatchObject({
      target: "teryt10",
      position: "Sejmik",
    });
    expect(folded.learns).toMatchObject({ position: "Sejmik", committee: KKW });
  });

  describe("bareFoldedSejmikRuns, for the ones the first run left bare", () => {
    const AUTHOR = "migration:merge-local-runs-stored-twice";
    const revision = (fields: Record<string, unknown> = {}) => ({
      id: "rev-1",
      data: {
        node_id: "xoQqPmr06ziH4e2wUIlh",
        update_user: AUTHOR,
        status: "approved",
        data: { type: "election", target: "teryt10", start_date: "2018-01-01" },
        ...fields,
      },
    });
    const edges = (fields: Record<string, unknown> = {}) =>
      new Map([
        [
          "xoQqPmr06ziH4e2wUIlh",
          {
            ...home.data,
            target: "teryt10",
            revision_id: "revisions/rev-1",
            ...fields,
          },
        ],
      ]);

    it("finds the copy it moved and showed by its own bare revision", () => {
      expect(bareFoldedSejmikRuns([revision()], edges(), terytOf)).toEqual([
        { edgeId: "xoQqPmr06ziH4e2wUIlh", revisionId: "rev-1" },
      ]);
    });

    it("leaves anybody else's revision, and one no longer shown", () => {
      expect(
        bareFoldedSejmikRuns(
          [revision({ update_user: "pipeline-people-import" })],
          edges(),
          terytOf,
        ),
      ).toEqual([]);
      expect(
        bareFoldedSejmikRuns(
          [revision()],
          edges({ revision_id: "revisions/later" }),
          terytOf,
        ),
      ).toEqual([]);
    });

    it("leaves a run already named, one below a województwo, and a removal", () => {
      expect(
        bareFoldedSejmikRuns(
          [revision()],
          edges({ position: "Sejmik" }),
          terytOf,
        ),
      ).toEqual([]);
      expect(
        bareFoldedSejmikRuns(
          [revision()],
          edges({ target: "teryt1061" }),
          terytOf,
        ),
      ).toEqual([]);
      expect(
        bareFoldedSejmikRuns(
          [revision({ data: { type: "election", deleted: true } })],
          edges(),
          terytOf,
        ),
      ).toEqual([]);
    });
  });
});

describe("readPkw", () => {
  const line = (row: Record<string, unknown>) => JSON.stringify(row);

  it("indexes a person's runs by page and by register entry, each run once", () => {
    const sejmikRow = {
      election_type: "Sejmik",
      election_year: "2024",
      teryt: "10",
      elected: false,
    };
    const { byPage, byEntry } = readPkw(
      [
        line({
          korytaId: "sobczak",
          rejestrIo: ["870160"],
          elections: [sejmikRow],
        }),
        // A second row for the same page: the run is still one run.
        line({
          korytaId: "sobczak",
          rejestrIo: [],
          elections: [{ ...sejmikRow, elected: true }],
        }),
        "",
      ].join("\n"),
    );

    expect(byPage.get("sobczak")).toEqual([
      { office: "Sejmik", year: "2024", teryt: "10", elected: true },
    ]);
    expect(byEntry.get("870160")).toEqual([
      { office: "Sejmik", year: "2024", teryt: "10", elected: false },
    ]);
  });
});

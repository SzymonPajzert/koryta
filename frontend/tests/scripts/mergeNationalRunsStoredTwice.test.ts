import { describe, it, expect } from "vitest";
import {
  planRuns,
  removalReason,
} from "../../scripts/migrate/merge-national-runs-stored-twice";
import type {
  RunPlan,
  StoredEdge,
} from "../../scripts/migrate/fold-candidacies";

const TERYTS: Record<string, string> = {
  teryt10: "10",
  teryt1061: "1061",
  teryt106101: "106101",
  teryt1465: "1465",
  teryt14: "14",
  teryt0261: "0261",
  teryt02: "02",
};
const terytOf = (id: unknown) => TERYTS[String(id)];

const TRZECIA_DROGA =
  "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI - POLSKIE STRONNICTWO LUDOWE";

/** Michał Jerzy Sobczak's 2023 Sejm run as the June upload filed it: under
 * Łódź, where PKW's list says he lives, live since his page was published. */
function atHome(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "vXyTHf5fBR3A5g8e7G6t",
    data: {
      source: "sobczak",
      target: "teryt1061",
      type: "election",
      name: "kandydatura",
      position: "Sejm",
      start_date: "2023-01-01",
      published: true,
      revision_id: "revisions/Kxz38uxRel1zIc8BFDnD",
      ...fields,
    },
  };
}

/** The same run as the 2026-09-12 upload stored it beside: under łódzkie,
 * with the committee, a draft. */
function inDistrict(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "edge_sobczak_teryt10_election_L8EZlPsKS1",
    data: {
      source: "sobczak",
      target: "teryt10",
      type: "election",
      name: "kandydatura",
      position: "Sejm",
      start_date: "2023-01-01",
      committee: TRZECIA_DROGA,
      published: false,
      ...fields,
    },
  };
}

function only(edges: StoredEdge[]): RunPlan {
  const { plans, skipped } = planRuns(edges, terytOf);
  expect(skipped).toEqual([]);
  expect(plans).toHaveLength(1);
  return plans[0]!;
}

describe("planRuns", () => {
  it("moves the live copy at home to the district and removes the draft there", () => {
    const plan = only([atHome(), inDistrict()]);

    expect(plan).toMatchObject({
      personId: "sobczak",
      office: "Sejm",
      keep: "vXyTHf5fBR3A5g8e7G6t",
      movedFrom: "teryt1061",
      placeId: "teryt10",
      published: true,
      remove: ["edge_sobczak_teryt10_election_L8EZlPsKS1"],
      learns: { committee: TRZECIA_DROGA },
    });
    // The whole document as the revision states it: what it said, in the
    // district, with what the draft knew. Nothing it owns rather than states.
    expect(plan.data).toEqual({
      source: "sobczak",
      target: "teryt10",
      type: "election",
      name: "kandydatura",
      position: "Sejm",
      start_date: "2023-01-01",
      committee: TRZECIA_DROGA,
    });
  });

  it("keeps the district's copy where it is live, and removes the one at home", () => {
    const plan = only([atHome(), inDistrict({ published: true })]);

    expect(plan).toMatchObject({
      keep: "edge_sobczak_teryt10_election_L8EZlPsKS1",
      movedFrom: null,
      published: true,
      remove: ["vXyTHf5fBR3A5g8e7G6t"],
      learns: {},
      data: null,
    });
  });

  it("keeps the district's copy where neither is live", () => {
    const plan = only([atHome({ published: false }), inDistrict()]);

    expect(plan).toMatchObject({
      keep: "edge_sobczak_teryt10_election_L8EZlPsKS1",
      movedFrom: null,
      published: false,
      remove: ["vXyTHf5fBR3A5g8e7G6t"],
      data: null,
    });
  });

  it("leaves a draft that would learn something for a reviewer", () => {
    const { plans, skipped } = planRuns(
      [atHome({ published: false, elected: true }), inDistrict()],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "draft would learn" }]);
  });

  it("writes onto a live district copy what only the copy at home knew", () => {
    const plan = only([
      atHome({ elected: true }),
      inDistrict({ published: true }),
    ]);

    expect(plan.learns).toEqual({ elected: true });
    expect(plan.data).toMatchObject({ target: "teryt10", elected: true });
  });

  it("folds a 2023 copy stored without its office into the Sejm run", () => {
    // Hubert Papaj's bare run under Jelenia Góra.
    const plan = only([atHome({ position: undefined }), inDistrict()]);

    expect(plan.keep).toBe("vXyTHf5fBR3A5g8e7G6t");
    expect(plan.learns).toEqual({ position: "Sejm", committee: TRZECIA_DROGA });
  });

  it("leaves a 2019 copy without its office, which could be the European run", () => {
    const { plans, skipped } = planRuns(
      [
        atHome({ position: undefined, start_date: "2019-01-01" }),
        inDistrict({ start_date: "2019-01-01" }),
      ],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("reports a copy at home in another województwo and folds nothing", () => {
    const { plans, skipped } = planRuns(
      [atHome({ target: "teryt1465" }), inDistrict()],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([
      {
        reason: "home in another województwo",
        ids: [
          "edge_sobczak_teryt10_election_L8EZlPsKS1",
          "vXyTHf5fBR3A5g8e7G6t",
        ],
      },
    ]);
  });

  it("takes a European run from a home in any województwo, as the ingest does", () => {
    const plan = only([
      atHome({
        target: "teryt1465",
        position: "Parlament Europejski",
        start_date: "2019-01-01",
      }),
      inDistrict({
        position: "Parlament Europejski",
        start_date: "2019-01-01",
      }),
    ]);

    expect(plan.movedFrom).toBe("teryt1465");
  });

  it("reports copies that disagree, inside the district's województwo too", () => {
    const { plans, skipped } = planRuns(
      [atHome({ committee: "KOMITET WYBORCZY KONFEDERACJA" }), inDistrict()],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "copies disagree" }]);
  });

  it("reports copies that disagree about a note a reviewer left on one", () => {
    const { plans, skipped } = planRuns(
      [
        atHome({ content: "Kandydował z listy PSL." }),
        inDistrict({ content: "Inna notatka." }),
      ],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "copies disagree" }]);
  });

  it("carries a note from the copy removed onto the live one that lacks it", () => {
    const plan = only([
      atHome(),
      inDistrict({ content: "Kandydował z listy PSL." }),
    ]);

    expect(plan.learns).toMatchObject({ content: "Kandydował z listy PSL." });
  });

  it("ignores a removed copy, wherever it is", () => {
    const { plans, skipped } = planRuns(
      [atHome({ deleted: true }), inDistrict()],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("leaves a run with two copies under a województwo for a reviewer", () => {
    const { plans, skipped } = planRuns(
      [
        atHome(),
        inDistrict(),
        { ...inDistrict(), id: "edge_sobczak_teryt10_election_second" },
      ],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toMatchObject([{ reason: "several district copies" }]);
  });

  it("leaves a bare copy that a Sejm and a Senate run would both take", () => {
    const { plans, skipped } = planRuns(
      [
        atHome({ position: undefined }),
        inDistrict(),
        {
          ...inDistrict({ position: "Senat" }),
          id: "edge_sobczak_teryt10_election_senat",
        },
      ],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped.map((run) => run.reason)).toEqual([
      "copy fits two runs",
      "copy fits two runs",
    ]);
  });

  it("never touches a local run, which a powiat is the place of", () => {
    const { plans, skipped } = planRuns(
      [
        atHome({ position: "Samorząd", start_date: "2024-01-01" }),
        inDistrict({ position: "Sejmik", start_date: "2024-01-01" }),
      ],
      terytOf,
    );

    expect(plans).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("finds nothing more once a run is folded", () => {
    const plan = only([atHome(), inDistrict()]);
    const folded: StoredEdge[] = [
      { id: plan.keep, data: { ...plan.data!, published: true } },
      { ...inDistrict(), data: { ...inDistrict().data, deleted: true } },
    ];

    expect(planRuns(folded, terytOf)).toEqual({ plans: [], skipped: [] });
  });

  it("says on the copy it removes which copy stays", () => {
    const plan = only([atHome(), inDistrict()]);

    expect(removalReason(plan)).toBe(
      "Duplikat: ta sama kandydatura (Sejm, 2023) była zapisana dwa razy, " +
        "pod miejscem zamieszkania kandydata i pod województwem okręgu. " +
        "Zostaje powiązanie vXyTHf5fBR3A5g8e7G6t.",
    );
  });
});

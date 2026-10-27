import { describe, it, expect } from "vitest";
import {
  planUnticked,
  twinsOf,
  untickedFalse,
  UNTICKED_BEFORE,
  type RevisionFacts,
} from "../../scripts/migrate/clear-unticked-elected";
import type { StoredEdge } from "../../scripts/migrate/fold-candidacies";

const TERYTS: Record<string, string> = {
  teryt0222: "0222",
  teryt14: "14",
  teryt1464: "1464",
  teryt1063: "1063",
  teryt26: "26",
};
const terytOf = (id: unknown) => TERYTS[String(id)];

const SEPTEMBER = "2026-09-10T10:00:00Z";
const NOVEMBER = "2026-11-02T04:00:00Z";

function revision(
  id: string,
  time: string,
  elected: unknown,
  fields: Partial<RevisionFacts> = {},
): RevisionFacts {
  return {
    id,
    update_time: time,
    status: "approved",
    data: elected === undefined ? {} : { elected },
    ...fields,
  };
}

/** Bartosz Granat's 2024 council run as a contributor saved it in the dialog:
 * the election day for a date, no office, the box left unticked. */
function boxCopy(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "V4ZNWpfV0v7kwHJ0dPRM",
    data: {
      source: "granat",
      target: "teryt0222",
      type: "election",
      name: "kandydatura",
      position: "",
      start_date: "2024-04-07",
      party: "PO",
      committee: "",
      term: "",
      references: [],
      by_election: false,
      elected: false,
      published: false,
      ...fields,
    },
  };
}

/** The same run as the night stored it beside: PKW's office, year, committee
 * and result. */
function nightCopy(fields: Record<string, unknown> = {}): StoredEdge {
  return {
    id: "edge_granat_teryt0222_election_JRVDiwvh1W",
    data: {
      source: "granat",
      target: "teryt0222",
      type: "election",
      name: "kandydatura",
      position: "Rada powiatu",
      start_date: "2024-01-01",
      party: "PO",
      committee: "KKW KOALICJA OBYWATELSKA",
      elected: true,
      published: false,
      ...fields,
    },
  };
}

describe("untickedFalse", () => {
  it("reads a false no revision ever stated as one of the old boxes", () => {
    expect(untickedFalse([])).toBe(true);
  });

  it("reads a false a form saved before the cutoff as a box", () => {
    expect(untickedFalse([revision("a", SEPTEMBER, false)])).toBe(true);
  });

  it("leaves a defeat recorded after the cutoff alone", () => {
    expect(new Date(NOVEMBER).getTime()).toBeGreaterThan(UNTICKED_BEFORE);
    expect(
      untickedFalse([
        revision("a", SEPTEMBER, undefined),
        revision("b", NOVEMBER, false, { update_automatic: true }),
      ]),
    ).toBe(false);
  });

  it("dates a false by the revision that turned it, not the last to restate it", () => {
    // A later enrichment restates the whole document, the box's false with it.
    expect(
      untickedFalse([
        revision("a", SEPTEMBER, false),
        revision("b", NOVEMBER, false, { update_automatic: true }),
      ]),
    ).toBe(true);
  });

  it("reads a defeat recorded after this script cleared the box as a defeat", () => {
    expect(
      untickedFalse([
        revision("a", SEPTEMBER, false),
        revision("b", "2026-10-28T09:00:00Z", undefined),
        revision("c", NOVEMBER, false, { update_automatic: true }),
      ]),
    ).toBe(false);
  });

  it("does not count a proposal or a rejected revision", () => {
    expect(
      untickedFalse([
        revision("a", SEPTEMBER, false),
        revision("proposal_x", NOVEMBER, false, { status: "pending" }),
        revision("c", NOVEMBER, false, { status: "rejected" }),
      ]),
    ).toBe(true);
  });
});

describe("twinsOf", () => {
  it("finds the night's copy of the run in the same place", () => {
    const twin = nightCopy();
    expect(twinsOf(boxCopy(), [boxCopy(), twin], terytOf)).toEqual([twin]);
  });

  it("finds it in the place that holds the old copy's", () => {
    // Robert Wojciech Stępień's 2001 Sejm run, filed under Siedlce by an old
    // upload and under its district by the night.
    const old = boxCopy({
      source: "stepien",
      target: "teryt1464",
      start_date: "2001",
    });
    const district = nightCopy({
      source: "stepien",
      target: "teryt14",
      position: "Sejm",
      start_date: "2001-01-01",
    });
    expect(twinsOf(old, [district], terytOf)).toEqual([district]);
  });

  it("ignores a copy of another election, place or person, or in another shape", () => {
    const old = boxCopy();
    expect(
      twinsOf(
        old,
        [
          nightCopy({ start_date: "2018-01-01" }),
          nightCopy({ target: "teryt1063" }),
          nightCopy({ source: "somebody else" }),
          nightCopy({ position: "" }),
          nightCopy({ start_date: "2024-04-07" }),
          nightCopy({ deleted: true }),
          nightCopy({ elected: false }),
        ],
        terytOf,
      ),
    ).toEqual([]);
  });

  it("finds nothing for a run with no date", () => {
    expect(
      twinsOf(boxCopy({ start_date: null }), [nightCopy()], terytOf),
    ).toEqual([]);
  });
});

describe("planUnticked", () => {
  it("removes the old copy where the night stored the run again", () => {
    const { plans, clears } = planUnticked(
      [boxCopy()],
      [boxCopy(), nightCopy()],
      terytOf,
    );
    expect(clears).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      personId: "granat",
      office: "Rada powiatu",
      startDate: "2024-01-01",
      keep: "edge_granat_teryt0222_election_JRVDiwvh1W",
      remove: ["V4ZNWpfV0v7kwHJ0dPRM"],
      movedFrom: null,
      data: null,
    });
  });

  it("takes the pipeline's word where the old copy says otherwise", () => {
    // Cezary Muszyński's 2018 run: the form's „Nowa Lewica”, PKW's SLD list.
    const { plans, clears } = planUnticked(
      [boxCopy({ party: "Nowa Lewica", name: "rada powiatu wołowskiego" })],
      [boxCopy(), nightCopy({ party: "SLD" })],
      terytOf,
    );
    expect(clears).toEqual([]);
    expect(plans[0]).toMatchObject({
      keep: "edge_granat_teryt0222_election_JRVDiwvh1W",
      learns: {},
    });
  });

  it("keeps a live old copy in the draft's place, saying what the pipeline does", () => {
    // Robert Szwagierczak's 2024 sejmik run: live as „sejmik”, PSL; the night's
    // copy a draft naming the office and the joint list, no single party.
    const old = boxCopy({
      target: "teryt26",
      start_date: "2024",
      name: "sejmik",
      party: "PSL",
      published: true,
    });
    const draft = nightCopy({
      target: "teryt26",
      position: "Sejmik",
      party: undefined,
      committee: "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI",
      elected: undefined,
    });
    const { plans, clears } = planUnticked([old], [old, draft], terytOf);
    expect(clears).toEqual([]);
    expect(plans[0]).toMatchObject({
      keep: "V4ZNWpfV0v7kwHJ0dPRM",
      remove: [draft.id],
      published: true,
    });
    expect(plans[0]!.data).toMatchObject({
      target: "teryt26",
      position: "Sejmik",
      start_date: "2024-01-01",
      committee: "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI",
      party: "PSL",
      name: "sejmik",
    });
    expect(plans[0]!.data).not.toHaveProperty("elected");
  });

  it("rewrites a live old copy the fold finds already saying everything", () => {
    const old = boxCopy({
      position: "Rada powiatu",
      committee: "KKW KOALICJA OBYWATELSKA",
      published: true,
    });
    const draft = nightCopy({ elected: undefined });
    const { plans } = planUnticked([old], [old, draft], terytOf);
    expect(plans[0]!.keep).toBe(old.id);
    expect(plans[0]!.data).toMatchObject({ start_date: "2024-01-01" });
    expect(plans[0]!.data).not.toHaveProperty("elected");
  });

  it("only clears the box where two of the night's copies could be the run", () => {
    // Krzysztof Jażdżyk's 2014: a mayoral run and a council run, both won.
    const old = boxCopy({ target: "teryt1063", start_date: "2014" });
    const mayor = {
      ...nightCopy({
        target: "teryt1063",
        position: "Prezydent",
        start_date: "2014-01-01",
      }),
      id: "mayor",
    };
    const council = {
      ...nightCopy({
        target: "teryt1063",
        position: "Rada miasta",
        start_date: "2014-01-01",
      }),
      id: "council",
    };
    const { plans, clears } = planUnticked(
      [old],
      [old, mayor, council],
      terytOf,
    );
    expect(plans).toEqual([]);
    expect(clears).toHaveLength(1);
    expect(clears[0]!.reason).toMatch(
      /^2 copies of the pipeline's could be the run/,
    );
  });

  it("only clears the box where the night has no copy of the run", () => {
    const { plans, clears } = planUnticked([boxCopy()], [boxCopy()], terytOf);
    expect(plans).toEqual([]);
    expect(clears).toEqual([
      { edge: boxCopy(), reason: "the pipeline has no copy of the run" },
    ]);
  });

  it("only clears the box where the night's draft would have to learn a source", () => {
    const old = boxCopy({ references: ["article"] });
    const { plans, clears } = planUnticked([old], [old, nightCopy()], terytOf);
    expect(plans).toEqual([]);
    expect(clears[0]!.reason).toMatch(/is a draft that would learn from it$/);
  });

  it("teaches a live night's copy the source only the old copy has", () => {
    const old = boxCopy({ references: ["article"] });
    const live = nightCopy({ published: true });
    const { plans } = planUnticked([old], [old, live], terytOf);
    expect(plans[0]).toMatchObject({
      keep: live.id,
      remove: [old.id],
      learns: { references: ["article"] },
    });
  });

  it("only clears the box where the two copies name different sources", () => {
    const old = boxCopy({ references: ["one"] });
    const live = nightCopy({ published: true, references: ["another"] });
    const { plans, clears } = planUnticked([old], [old, live], terytOf);
    expect(plans).toEqual([]);
    expect(clears[0]!.reason).toMatch(/each say something the other does not$/);
  });
});

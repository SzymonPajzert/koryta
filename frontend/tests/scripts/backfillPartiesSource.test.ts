import { describe, it, expect } from "vitest";
import {
  decide,
  proposalsToPin,
  type NodeFacts,
  type RevisionFacts,
} from "../../scripts/migrate/backfill-parties-source";

const DAY = 24 * 60 * 60 * 1000;

function node(overrides: Partial<NodeFacts> = {}): NodeFacts {
  return {
    parties: [],
    pinned: false,
    gone: false,
    revisionId: undefined,
    ...overrides,
  };
}

function revision(
  id: string,
  day: number,
  overrides: Partial<RevisionFacts> = {},
): RevisionFacts {
  return {
    id,
    updateTime: day * DAY,
    automatic: false,
    updateUser: "someone",
    pinned: false,
    removal: false,
    ...overrides,
  };
}

/** What the ingest files: written to the node as it is filed. */
function ingest(id: string, day: number, parties: string[]): RevisionFacts {
  return revision(id, day, {
    automatic: true,
    status: "approved",
    reviewTime: day * DAY,
    parties,
  });
}

/** A person's edit, approved by a reviewer the same day. */
function approvedEdit(
  id: string,
  day: number,
  parties: string[],
): RevisionFacts {
  return revision(id, day, {
    status: "approved",
    reviewTime: day * DAY,
    parties,
  });
}

describe("decide", () => {
  it("pins a list a reviewer approved and nothing has touched since", () => {
    const revisions = [
      ingest("created", 1, ["PSL", "Polska 2050"]),
      approvedEdit("edit", 2, ["PSL"]),
    ];
    expect(
      decide(node({ parties: ["PSL"], revisionId: "edit" }), revisions),
    ).toEqual({ action: "pin" });
  });

  it("puts back the list an upload widened, the way SLD came back", () => {
    // A reviewer took SLD off; the next upload's union put it back. The stamp
    // would have stopped that, so the list it would have kept is the person's.
    const revisions = [
      ingest("created", 1, ["SLD"]),
      approvedEdit("edit", 2, ["Nowa Lewica"]),
      ingest("upload", 3, ["Nowa Lewica", "SLD"]),
    ];
    expect(
      decide(
        node({ parties: ["Nowa Lewica", "SLD"], revisionId: "upload" }),
        revisions,
      ),
    ).toEqual({ action: "restore", parties: ["Nowa Lewica"] });
  });

  it("counts the revision a page was created by, approved or not", () => {
    // The 2025-12-20 backfill of the hand-curated dataset, and every page a
    // person added, carry no status - but the page was written from them.
    const revisions = [
      revision("backfill", 1, { parties: ["PSL"] }),
      ingest("upload", 5, ["PSL", "Polska 2050"]),
    ];
    expect(
      decide(
        node({ parties: ["PSL", "Polska 2050"], revisionId: "upload" }),
        revisions,
      ),
    ).toEqual({ action: "restore", parties: ["PSL"] });
  });

  it("puts back a list a duplicate merge widened", () => {
    const revisions = [
      approvedEdit("edit", 2, ["Nowa Lewica"]),
      revision("merge", 4, {
        updateUser: "migration:merge-duplicate-people",
        status: "approved",
        reviewTime: 4 * DAY,
        parties: ["Nowa Lewica", "SLD"],
      }),
    ];
    expect(
      decide(
        node({ parties: ["Nowa Lewica", "SLD"], revisionId: "merge" }),
        revisions,
      ),
    ).toEqual({ action: "restore", parties: ["Nowa Lewica"] });
  });

  it("does not pin a list only the pipeline ever wrote", () => {
    const revisions = [
      ingest("created", 1, ["PSL"]),
      ingest("upload", 3, ["PSL", "Polska 2050"]),
    ];
    expect(
      decide(node({ parties: ["PSL", "Polska 2050"] }), revisions),
    ).toBeUndefined();
  });

  it("leaves a node a person has pinned since", () => {
    const revisions = [approvedEdit("edit", 2, ["PSL"])];
    expect(
      decide(node({ parties: ["PSL"], pinned: true }), revisions),
    ).toBeUndefined();
  });

  it("ignores a proposal nobody approved", () => {
    const revisions = [
      ingest("created", 1, ["PSL", "Polska 2050"]),
      revision("proposal", 2, { status: "pending", parties: ["PSL"] }),
    ];
    expect(
      decide(node({ parties: ["PSL", "Polska 2050"] }), revisions),
    ).toBeUndefined();
  });

  it("does not take a removal's copy of the fields for a statement", () => {
    const revisions = [
      ingest("created", 1, ["PSL", "Polska 2050"]),
      revision("removal", 2, {
        status: "approved",
        reviewTime: 2 * DAY,
        parties: ["PSL", "Polska 2050"],
        removal: true,
      }),
    ];
    expect(
      decide(node({ parties: ["PSL", "Polska 2050"] }), revisions),
    ).toBeUndefined();
  });

  it("takes a re-approved creation as the later word", () => {
    // Created with one list, edited to another, then the creation approved
    // again: approving writes it over the node, so that is the list now.
    const revisions = [
      revision("created", 1, {
        status: "approved",
        reviewTime: 10 * DAY,
        parties: ["PSL"],
      }),
      approvedEdit("edit", 3, ["PSL", "PiS"]),
    ];
    expect(
      decide(node({ parties: ["PSL"], revisionId: "created" }), revisions),
    ).toEqual({ action: "pin" });
  });

  it("leaves a list that lost a party the person stated", () => {
    const revisions = [approvedEdit("edit", 2, ["PSL", "PiS"])];
    expect(decide(node({ parties: ["PSL"] }), revisions)).toMatchObject({
      action: "skip",
    });
  });

  it("leaves a widening no revision records", () => {
    const revisions = [approvedEdit("edit", 2, ["PSL"])];
    expect(
      decide(node({ parties: ["PSL", "Polska 2050"] }), revisions),
    ).toMatchObject({
      action: "skip",
      reason: "the stored list was written outside any revision",
    });
  });

  it("leaves a list with a later human revision whose fate is unknown", () => {
    // No status, not the first, not pointed at: before statuses were
    // recorded that is either a proposal nobody took or one approved and then
    // written over, and which of the two decides what the person last said.
    const revisions = [
      revision("backfill", 1, { parties: ["PSL"] }),
      revision("old-edit", 2, { parties: ["PSL", "PiS"] }),
      ingest("upload", 5, ["PSL", "PiS", "Polska 2050"]),
    ];
    expect(
      decide(
        node({ parties: ["PSL", "PiS", "Polska 2050"], revisionId: "upload" }),
        revisions,
      ),
    ).toMatchObject({ action: "skip" });
  });

  it("leaves a deleted or merged page", () => {
    const revisions = [approvedEdit("edit", 2, ["PSL"])];
    expect(
      decide(node({ parties: ["PSL"], gone: true }), revisions),
    ).toMatchObject({ action: "skip", reason: "deleted or merged" });
  });

  it("pins an empty list, which is a person saying no party", () => {
    const revisions = [
      ingest("created", 1, ["PSL"]),
      approvedEdit("edit", 2, []),
    ];
    expect(
      decide(node({ parties: [], revisionId: "edit" }), revisions),
    ).toEqual({ action: "pin" });
  });

  it("compares lists as sets", () => {
    const revisions = [approvedEdit("edit", 2, ["SLD", "Nowa Lewica"])];
    expect(
      decide(
        node({ parties: ["Nowa Lewica", "SLD"], revisionId: "edit" }),
        revisions,
      ),
    ).toEqual({ action: "pin" });
  });
});

describe("proposalsToPin", () => {
  it("stamps the human proposals waiting for a reviewer", () => {
    const revisions = [
      revision("edit", 2, { status: "pending", parties: ["PSL"] }),
      revision("new-page", 1, { status: "pending", parties: [] }),
    ];
    expect(proposalsToPin(revisions)).toEqual(["edit", "new-page"]);
  });

  it("leaves decided, stamped and the pipeline's revisions alone", () => {
    const revisions = [
      approvedEdit("approved", 2, ["PSL"]),
      revision("rejected", 3, { status: "rejected", parties: ["PSL"] }),
      revision("stamped", 4, {
        status: "pending",
        parties: ["PSL"],
        pinned: true,
      }),
      revision("pipeline", 5, {
        automatic: true,
        status: "pending",
        parties: ["PSL"],
      }),
      revision("removal", 6, {
        status: "pending",
        parties: ["PSL"],
        removal: true,
      }),
      revision("no-parties", 7, { status: "pending" }),
    ];
    expect(proposalsToPin(revisions)).toEqual([]);
  });

  it("leaves a revision from before statuses were recorded", () => {
    // Usually the one a page was created by and that has since been written
    // over. The migration repoints nodes itself, so taking "not pointed at"
    // for "pending" would find a fresh batch to stamp on every run.
    const revisions = [revision("backfill", 1, { parties: ["PSL"] })];
    expect(proposalsToPin(revisions)).toEqual([]);
  });
});

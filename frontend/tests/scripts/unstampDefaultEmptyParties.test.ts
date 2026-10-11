import { describe, it, expect } from "vitest";
import {
  decide,
  proposalsToUnpin,
  type NodeFacts,
  type RevisionFacts,
} from "../../scripts/migrate/unstamp-default-empty-parties";

function node(overrides: Partial<NodeFacts> = {}): NodeFacts {
  return { parties: [], pinned: true, gone: false, ...overrides };
}

function revision(
  id: string,
  overrides: Partial<RevisionFacts> = {},
): RevisionFacts {
  return { id, pinned: false, ...overrides };
}

describe("decide", () => {
  it("unmarks the empty list a page was created with", () => {
    // The 83: created through the form without touching the party select,
    // marked by /api/revisions/create or by backfill-parties-source.ts.
    const revisions = [
      revision("created", { status: "approved", parties: [], pinned: true }),
    ];
    expect(decide(node(), revisions)).toEqual({ action: "unpin" });
  });

  it("unmarks a draft whose only revisions are pending", () => {
    const revisions = [
      revision("created", { status: "pending", parties: [] }),
      revision("backfill", { status: "pending", parties: [], pinned: true }),
    ];
    expect(decide(node(), revisions)).toEqual({ action: "unpin" });
  });

  it("keeps the mark where a revision ever listed a party", () => {
    // The other two on the 2026-10-09 evening export: a party proposed before
    // statuses were recorded, and an empty list after it. Somebody may have
    // taken it off, and then the mark is their answer.
    const revisions = [
      revision("created", { parties: [] }),
      revision("old-edit", { parties: ["PO"] }),
      revision("backfill", { status: "pending", parties: [], pinned: true }),
    ];
    expect(decide(node(), revisions)).toMatchObject({ action: "skip" });
  });

  it("keeps the mark where only a proposal nobody answered listed a party", () => {
    const revisions = [
      revision("created", { status: "approved", parties: [], pinned: true }),
      revision("proposal", { status: "pending", parties: ["PSL"] }),
    ];
    expect(decide(node(), revisions)).toMatchObject({ action: "skip" });
  });

  it("counts a party whoever listed it, the pipeline included", () => {
    const revisions = [
      revision("upload", { status: "approved", parties: ["SLD"] }),
    ];
    expect(decide(node(), revisions)).toMatchObject({ action: "skip" });
  });

  it("leaves a list with a party on it", () => {
    expect(decide(node({ parties: ["PSL"] }), [])).toBeUndefined();
  });

  it("leaves a list nobody marked", () => {
    expect(decide(node({ pinned: false }), [])).toBeUndefined();
  });

  it("leaves a deleted or merged page", () => {
    expect(decide(node({ gone: true }), [])).toEqual({
      action: "skip",
      reason: "deleted or merged",
    });
  });
});

describe("proposalsToUnpin", () => {
  it("unmarks every pending revision carrying the mark on a page it unmarks", () => {
    // Approving writes a revision's data over the node with `set`, so any of
    // these would put the mark straight back: the creating proposal of a
    // draft, the backfill's own pending revision, an edit filed under the old
    // rule.
    const revisions = [
      revision("created", { status: "pending", parties: [], pinned: true }),
      revision("backfill", { status: "pending", parties: [], pinned: true }),
      revision("edit", { status: "pending", parties: [], pinned: true }),
    ];
    expect(proposalsToUnpin(node(), revisions)).toEqual([
      "created",
      "backfill",
      "edit",
    ]);
  });

  it("unmarks a marked proposal on a page that was never marked", () => {
    // 12 on the 10-09 export: an edit of something else on a page with an
    // empty list, marked by the old rule and still waiting.
    const revisions = [
      revision("created", { status: "approved", parties: [] }),
      revision("edit", { status: "pending", parties: [], pinned: true }),
    ];
    expect(proposalsToUnpin(node({ pinned: false }), revisions)).toEqual([
      "edit",
    ]);
  });

  it("leaves decided revisions and the ones from before statuses", () => {
    const revisions = [
      revision("approved", { status: "approved", parties: [], pinned: true }),
      revision("rejected", { status: "rejected", parties: [], pinned: true }),
      revision("old", { parties: [], pinned: true }),
      revision("unmarked", { status: "pending", parties: [] }),
    ];
    expect(proposalsToUnpin(node(), revisions)).toEqual([]);
  });

  it("leaves everything on a page whose list ever had a party", () => {
    const revisions = [
      revision("old-edit", { parties: ["PiS"] }),
      revision("backfill", { status: "pending", parties: [], pinned: true }),
    ];
    expect(proposalsToUnpin(node(), revisions)).toEqual([]);
    expect(proposalsToUnpin(node({ parties: ["PiS"] }), [])).toEqual([]);
  });

  it("leaves a deleted or merged page", () => {
    const revisions = [
      revision("edit", { status: "pending", parties: [], pinned: true }),
    ];
    expect(proposalsToUnpin(node({ gone: true }), revisions)).toEqual([]);
  });
});

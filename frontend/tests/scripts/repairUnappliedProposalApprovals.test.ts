import { describe, it, expect } from "vitest";
import {
  reopens,
  repointing,
} from "../../scripts/migrate/repair-unapplied-proposal-approvals";
import type { Revision } from "../../shared/model";

/** A candidacy as the ingest wrote it, before anybody learned its committee. */
const candidacy = {
  source: "person",
  target: "region",
  type: "election",
  name: "kandydatura",
  position: "Samorząd",
  start_date: "2024-01-01",
};

/** The pipeline's committee for it, never written to the edge. */
const committee = { ...candidacy, committee: "KWW Nasza Gmina" };

function revision(
  id: string,
  data: Record<string, unknown>,
  fields: Partial<Revision> = {},
): Revision & { id: string } {
  return {
    id,
    node_id: "edge",
    collection: "edges",
    data,
    update_time: "2026-09-01T00:00:00.000Z",
    update_user: "pipeline-people-import",
    update_automatic: true,
    ...fields,
  };
}

const faked = {
  status: "approved" as const,
  review_user: "admin",
  review_time: "2026-09-01T12:52:35.000Z",
};

describe("reopens", () => {
  it("reopens a proposal publishing marked approved without applying it", () => {
    expect(
      reopens(revision("proposal_edge_x", committee, faked), candidacy),
    ).toBe(true);
  });

  it("leaves one that was approved and applied", () => {
    // Approved through /api/revisions/approve, which writes it to the edge.
    expect(
      reopens(revision("proposal_edge_x", committee, faked), committee),
    ).toBe(false);
  });

  it("leaves a rejection standing whatever the edge says", () => {
    expect(
      reopens(
        revision("proposal_edge_x", committee, {
          status: "rejected",
          review_user: "admin",
          reject_reason: "inna osoba",
        }),
        candidacy,
      ),
    ).toBe(false);
  });

  it("takes the review fields off one already back to pending", () => {
    expect(
      reopens(
        revision("proposal_edge_x", committee, {
          status: "pending",
          review_user: "admin",
        }),
        candidacy,
      ),
    ).toBe(true);
  });

  it("leaves one that is simply waiting", () => {
    // What the night left of most of the faked approvals: pending, no review
    // fields. Only their edges' pointers need fixing.
    expect(
      reopens(
        revision("proposal_edge_x", committee, { status: "pending" }),
        candidacy,
      ),
    ).toBe(false);
  });
});

describe("repointing", () => {
  const written = revision("written", candidacy, {
    status: undefined,
    update_time: "2026-06-01T00:00:00.000Z",
  });
  const proposal = revision("proposal_edge_x", committee, faked);

  it("points an edge at the revision it holds instead of the proposal it does not", () => {
    const repair = repointing(
      {
        ...candidacy,
        published: true,
        revision_id: "revisions/proposal_edge_x",
      },
      [proposal, written],
    );

    expect(repair).toEqual({ from: "proposal_edge_x", to: written });
  });

  it("points it at nothing when it holds none of its revisions", () => {
    // proposal_TQ3Z...: the person was merged away since, so the edge names
    // another source than every revision of it.
    const repair = repointing(
      {
        ...candidacy,
        source: "survivor",
        published: true,
        revision_id: { path: "revisions/proposal_edge_x" },
      },
      [proposal, written],
    );

    expect(repair).toEqual({ from: "proposal_edge_x", to: undefined });
  });

  it("passes over a rejected revision the edge holds", () => {
    const refused = revision("refused", candidacy, {
      status: "rejected",
      update_time: "2026-08-01T00:00:00.000Z",
    });

    const repair = repointing(
      { ...candidacy, revision_id: "revisions/proposal_edge_x" },
      [proposal, refused, written],
    );

    expect(repair?.to?.id).toBe("written");
  });

  it("leaves an edge pointing at a proposal it holds", () => {
    expect(
      repointing({ ...committee, revision_id: "revisions/proposal_edge_x" }, [
        proposal,
        written,
      ]),
    ).toBeUndefined();
  });

  it("leaves an edge pointing at an ordinary revision, held or not", () => {
    // Moved onto another person by a merge, most of them - not this bug.
    expect(
      repointing(
        { ...candidacy, source: "survivor", revision_id: "revisions/written" },
        [written],
      ),
    ).toBeUndefined();
  });

  it("leaves an edge pointing at nothing", () => {
    expect(repointing(candidacy, [proposal, written])).toBeUndefined();
  });
});

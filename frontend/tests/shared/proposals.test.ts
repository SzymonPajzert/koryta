import { describe, it, expect } from "vitest";
import {
  emptyProposalCounts,
  matchesStoredStatus,
  proposalStatusHints,
  proposalStatusLabels,
  proposalStatuses,
  resolveProposalStatus,
} from "../../shared/proposals";
import { ink, meetsAaText, surface } from "../../shared/colors";

const ID = "rev-2";

describe("resolveProposalStatus", () => {
  it("takes a rejection as final", () => {
    // Nothing the target says can un-reject a revision.
    expect(resolveProposalStatus({ id: ID, status: "rejected" })).toEqual({
      status: "rejected",
      derived: false,
    });
    expect(
      resolveProposalStatus({ id: ID, status: "rejected", approvedId: ID }),
    ).toEqual({ status: "rejected", derived: false });
  });

  it("keeps the approval the target confirms", () => {
    expect(
      resolveProposalStatus({ id: ID, status: "approved", approvedId: ID }),
    ).toEqual({ status: "approved", derived: false });
  });

  it("calls an approval the entry has moved on from superseded", () => {
    // `status: "approved"` is written once and never revisited, so the moment
    // a newer revision is approved the older one still claims to be current.
    // Reading it back as `approved` tells its author their words are on the
    // site when they are not.
    expect(
      resolveProposalStatus({
        id: ID,
        status: "approved",
        approvedId: "rev-9",
      }),
    ).toEqual({ status: "superseded", derived: true });

    // Same when the target has no approved revision at all, or could not be
    // read: what is certain is that it is not serving this one.
    expect(resolveProposalStatus({ id: ID, status: "approved" })).toEqual({
      status: "superseded",
      derived: true,
    });
  });

  it("reads a target pointing at an unmarked revision as approved", () => {
    // Most revisions predate review and carry no status; a node pointing at
    // one is serving it, whatever the revision says about itself.
    expect(resolveProposalStatus({ id: ID, approvedId: ID })).toEqual({
      status: "approved",
      derived: true,
    });
    expect(
      resolveProposalStatus({ id: ID, status: "pending", approvedId: ID }),
    ).toEqual({ status: "approved", derived: true });
  });

  it("leaves a revision nothing points at pending", () => {
    expect(resolveProposalStatus({ id: ID })).toEqual({
      status: "pending",
      derived: true,
    });
    expect(resolveProposalStatus({ id: ID, approvedId: "rev-9" })).toEqual({
      status: "pending",
      derived: true,
    });

    // Stored as pending, so the answer is read off the revision rather than
    // worked out, and the queue does not have to hedge about it.
    expect(resolveProposalStatus({ id: ID, status: "pending" })).toEqual({
      status: "pending",
      derived: false,
    });
  });
});

describe("matchesStoredStatus", () => {
  it("counts a superseded proposal as an approved one", () => {
    // The filter is written in stored terms and `superseded` has no stored
    // form, so a reader asking for approved proposals means both.
    expect(matchesStoredStatus("superseded", "approved")).toBe(true);
    expect(matchesStoredStatus("approved", "approved")).toBe(true);
    expect(matchesStoredStatus("pending", "approved")).toBe(false);
    expect(matchesStoredStatus("rejected", "approved")).toBe(false);
  });

  it("lets everything through `all`", () => {
    for (const status of proposalStatuses) {
      expect(matchesStoredStatus(status, "all")).toBe(true);
    }
  });

  it("matches any other filter only against its own name", () => {
    for (const filter of ["pending", "rejected"] as const) {
      for (const status of proposalStatuses) {
        expect(matchesStoredStatus(status, filter)).toBe(status === filter);
      }
    }
  });
});

describe("proposalStatusLabels", () => {
  it("gives every state a word, a colour and a reason", () => {
    for (const status of proposalStatuses) {
      expect(proposalStatusLabels[status].label).toBeTruthy();
      expect(proposalStatusLabels[status].color).toBeTruthy();
      expect(proposalStatusHints[status]).toBeTruthy();
    }
  });

  it("draws every state in an ink that reads as text", () => {
    // A tonal chip paints its colour as the text and a bare icon carries it
    // alone; Vuetify's own `warning`, `success` and `grey` are 2.1-2.5:1 there.
    for (const status of proposalStatuses) {
      const token = proposalStatusLabels[status].color;
      expect(token).toMatch(/^ink-/);
      const hex = ink[token.slice("ink-".length) as keyof typeof ink];
      expect(meetsAaText(hex, surface.white)).toBe(true);
    }
  });

  it("does not spend one word on two states", () => {
    // `Zastąpiona` exists only to be told apart from `Zatwierdzona`.
    const labels = proposalStatuses.map(
      (status) => proposalStatusLabels[status].label,
    );
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("emptyProposalCounts", () => {
  it("starts every state at zero", () => {
    const counts = emptyProposalCounts();
    for (const status of proposalStatuses) expect(counts[status]).toBe(0);
  });
});

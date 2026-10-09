import { describe, it, expect } from "vitest";
import {
  decide,
  proposalsToPin,
  type NodeFacts,
  type RevisionFacts,
} from "../../scripts/migrate/backfill-name-source";

const DAY = 24 * 60 * 60 * 1000;

function node(overrides: Partial<NodeFacts> = {}): NodeFacts {
  return {
    name: undefined,
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
function ingest(id: string, day: number, name: string): RevisionFacts {
  return revision(id, day, {
    automatic: true,
    status: "approved",
    reviewTime: day * DAY,
    name,
  });
}

/** A person's edit, approved by a reviewer the same day. */
function approvedEdit(id: string, day: number, name: string): RevisionFacts {
  return revision(id, day, {
    status: "approved",
    reviewTime: day * DAY,
    name,
  });
}

describe("decide", () => {
  it("marks the name of a page a person created, still as they typed it", () => {
    // "Stawy Milickie" came in with the hand-curated dataset; the next company
    // upload would have put the register's capitals and the town over it.
    const revisions = [
      revision("created", 1, { name: "Stawy Milickie" }),
      ingest("upload", 3, "Stawy Milickie"),
    ];
    expect(
      decide(node({ name: "Stawy Milickie", revisionId: "upload" }), revisions),
    ).toEqual({ action: "pin" });
  });

  it("marks a rename a reviewer approved", () => {
    const revisions = [
      ingest("created", 1, "0000345690"),
      approvedEdit("rename", 5, "Polskie LNG (wykreślone)"),
    ];
    expect(
      decide(
        node({ name: "Polskie LNG (wykreślone)", revisionId: "rename" }),
        revisions,
      ),
    ).toEqual({ action: "pin" });
  });

  it("does not mark a name only the pipelines ever wrote", () => {
    const revisions = [
      ingest("created", 1, "CAPITAL PARTNERS (Warszawa)"),
      ingest("upload", 3, "BUMECH DEFENSE PARTNERS (Warszawa)"),
    ];
    expect(
      decide(node({ name: "BUMECH DEFENSE PARTNERS (Warszawa)" }), revisions),
    ).toBeUndefined();
  });

  it("does not take a person's edit of another field for naming the place", () => {
    // The form always sends the name, so every edit states one. Passing it
    // through unchanged is not giving it.
    const revisions = [
      ingest("created", 1, "TRAMWAJE ŚLĄSKIE"),
      approvedEdit("public", 4, "TRAMWAJE ŚLĄSKIE"),
    ];
    expect(
      decide(
        node({ name: "TRAMWAJE ŚLĄSKIE", revisionId: "public" }),
        revisions,
      ),
    ).toBeUndefined();
  });

  it("leaves a name the pipelines have written over since", () => {
    // Putting the person's back is a decision, not a repair: the register's
    // spelling has stood on the page since.
    const revisions = [
      revision("created", 1, { name: "Pogotowie w Legnicy" }),
      ingest("upload", 3, "POGOTOWIE RATUNKOWE W LEGNICY (Legnica)"),
    ];
    expect(
      decide(
        node({
          name: "POGOTOWIE RATUNKOWE W LEGNICY (Legnica)",
          revisionId: "upload",
        }),
        revisions,
      ),
    ).toMatchObject({ action: "skip" });
  });

  it("ignores a rename nobody approved", () => {
    const revisions = [
      ingest("created", 1, "OPOLSKA (Opole)"),
      revision("proposal", 2, {
        status: "pending",
        name: "Opolska Izba Gospodarcza",
      }),
    ];
    expect(
      decide(node({ name: "OPOLSKA (Opole)" }), revisions),
    ).toBeUndefined();
  });

  it("does not take a removal's copy of the fields for a name", () => {
    const revisions = [
      ingest("created", 1, "ZAKŁAD KOMUNALNY"),
      revision("removal", 2, {
        status: "approved",
        reviewTime: 2 * DAY,
        name: "Zakład Komunalny",
        removal: true,
      }),
    ];
    expect(
      decide(node({ name: "ZAKŁAD KOMUNALNY" }), revisions),
    ).toBeUndefined();
  });

  it("does not count a migration as a person", () => {
    const revisions = [
      ingest("created", 1, "ZAK (Kędzierzyn-Koźle)"),
      revision("migration", 2, {
        updateUser: "migration:merge-duplicate-places",
        status: "approved",
        reviewTime: 2 * DAY,
        name: "ZAKSA (Kędzierzyn-Koźle)",
      }),
    ];
    expect(
      decide(node({ name: "ZAKSA (Kędzierzyn-Koźle)" }), revisions),
    ).toBeUndefined();
  });

  it("leaves a place already marked", () => {
    const revisions = [revision("created", 1, { name: "Stawy Milickie" })];
    expect(
      decide(node({ name: "Stawy Milickie", pinned: true }), revisions),
    ).toBeUndefined();
  });

  it("leaves a deleted place alone, and says so", () => {
    const revisions = [revision("created", 1, { name: "Stawy Milickie" })];
    expect(
      decide(node({ name: "Stawy Milickie", gone: true }), revisions),
    ).toEqual({ action: "skip", reason: "deleted or merged" });
  });
});

describe("proposalsToPin", () => {
  const waiting = (id: string, name: string, extra = {}) =>
    revision(id, 6, { status: "pending", name, ...extra });

  it("marks every waiting proposal on a place it marks", () => {
    // Approving one writes its snapshot over the node, mark or no mark.
    const revisions = [
      revision("created", 1, { name: "Stawy Milickie" }),
      waiting("public", "Stawy Milickie"),
    ];
    expect(
      proposalsToPin(node({ name: "Stawy Milickie" }), revisions, true),
    ).toEqual(["public"]);
  });

  it("marks a waiting rename of a place named by the pipelines", () => {
    const revisions = [
      ingest("created", 1, "KRAJOWA (Warszawa)"),
      waiting("rename", "Krajowa Izba Gospodarcza"),
      waiting("public", "KRAJOWA (Warszawa)"),
    ];
    expect(
      proposalsToPin(node({ name: "KRAJOWA (Warszawa)" }), revisions, false),
    ).toEqual(["rename"]);
  });

  it("leaves decided, marked and machine-made revisions alone", () => {
    const revisions = [
      waiting("marked", "Inna nazwa", { pinned: true }),
      revision("decided", 6, { status: "rejected", name: "Inna nazwa" }),
      revision("pipeline", 6, {
        status: "pending",
        automatic: true,
        name: "Inna nazwa",
      }),
      waiting("removal", "Inna nazwa", { removal: true }),
    ];
    expect(proposalsToPin(node({ name: "Nazwa" }), revisions, true)).toEqual(
      [],
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  SPLIT_LIVE_AT,
  differences,
  edgeCreatedAt,
  planSeat,
  type StoredEdge,
} from "../../scripts/migrate/split-seat-edges";

const BEFORE = Date.parse("2026-08-21T13:00:00Z");
const AFTER = Date.parse("2026-08-29T18:13:53Z");

function owns(id: string, overrides: Partial<StoredEdge> = {}): StoredEdge {
  return {
    id,
    source: "teryt0201",
    target: "pks",
    type: "owns",
    published: true,
    revision_id: "revisions/owns-rev",
    ...overrides,
  };
}

function seat(id: string, overrides: Partial<StoredEdge> = {}): StoredEdge {
  return {
    id,
    source: "teryt0201",
    target: "pks",
    type: "seat",
    published: true,
    revision_id: "revisions/seat-rev",
    ...overrides,
  };
}

describe("planSeat", () => {
  it("leaves a shareholder alone, even beside a seat from the same powiat", () => {
    // The 41 taken ids of the 10-09 export: Powiat bolesławiecki owns PKS
    // Bolesławiec and seats it too. The two documents agree on every field but
    // the type, so comparing fields would call them one fact - only the date
    // says the `owns` edge is the register's shareholder, written after the
    // split, and dropping or retyping it would delete real ownership.
    const edge = owns("edge_teryt0201_pks_owns");
    const twin = seat("edge_teryt0201_pks_seat");
    expect(differences(edge, twin)).toEqual([]);
    expect(
      planSeat(edge, AFTER, { seatsOfCompany: [twin], takenBy: twin }),
    ).toEqual({ action: "shareholder" });
  });

  it("leaves a shareholder of a company seated elsewhere alone", () => {
    // 1,661 of the 1,799: retyped, each would be a second seat.
    const edge = owns("edge_teryt0201011_pks_owns", {
      source: "teryt0201011",
    });
    expect(
      planSeat(edge, AFTER, {
        seatsOfCompany: [seat("edge_teryt0201_pks_seat")],
      }),
    ).toEqual({ action: "shareholder" });
  });

  it("draws the line at SPLIT_LIVE_AT itself", () => {
    const edge = owns("Twm20atuwEHkzrNq8hMe");
    const at = Date.parse(SPLIT_LIVE_AT);
    expect(planSeat(edge, at, { seatsOfCompany: [] })).toEqual({
      action: "shareholder",
    });
    expect(planSeat(edge, at - 1, { seatsOfCompany: [] })).toEqual({
      action: "update",
    });
  });

  it("reports an edge with no revision to date it by", () => {
    expect(
      planSeat(owns("Twm20atuwEHkzrNq8hMe"), null, { seatsOfCompany: [] }),
    ).toEqual({ action: "undated" });
  });

  it("updates a random-id seat in place", () => {
    expect(
      planSeat(owns("Twm20atuwEHkzrNq8hMe"), BEFORE, { seatsOfCompany: [] }),
    ).toEqual({ action: "update" });
  });

  it("moves a derived-id seat to the free _seat id", () => {
    expect(
      planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, { seatsOfCompany: [] }),
    ).toEqual({ action: "move", newId: "edge_teryt0201_pks_seat" });
  });

  describe("when the _seat id is taken", () => {
    it("drops the owns copy a stored seat already says", () => {
      // Moving it would `set` over the seat. The two say the same thing, so
      // the copy goes and its revisions are repointed to the seat.
      const twin = seat("edge_teryt0201_pks_seat");
      expect(
        planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
          seatsOfCompany: [twin],
          takenBy: twin,
        }),
      ).toEqual({ action: "drop", into: "edge_teryt0201_pks_seat" });
    });

    it("treats a blank written two ways as the same blank", () => {
      // /api/edges/create stores `false` and `""` where the ingest stores
      // nothing.
      const twin = seat("edge_teryt0201_pks_seat", {
        published: false,
        name: "",
      });
      expect(
        planSeat(
          owns("edge_teryt0201_pks_owns", { published: undefined }),
          BEFORE,
          {
            seatsOfCompany: [twin],
            takenBy: twin,
          },
        ),
      ).toEqual({ action: "drop", into: "edge_teryt0201_pks_seat" });
    });

    it("skips a pair that disagrees about being published", () => {
      const twin = seat("edge_teryt0201_pks_seat", { published: false });
      expect(
        planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
          seatsOfCompany: [twin],
          takenBy: twin,
        }),
      ).toEqual({
        action: "skip",
        reason: "the stored seat disagrees about published",
        others: ["edge_teryt0201_pks_seat"],
      });
    });

    it("skips a pair whose seat somebody removed", () => {
      // An admin ruled on the seat; dropping the owns copy would finish the
      // removal on their behalf, keeping it would undo it. Not this script's
      // call.
      const twin = seat("edge_teryt0201_pks_seat", { deleted: true });
      const plan = planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
        seatsOfCompany: [twin],
        takenBy: twin,
      });
      expect(plan).toMatchObject({
        action: "skip",
        reason: "the stored seat disagrees about deleted",
      });
    });

    it("skips an id held by something that is not this pair's seat", () => {
      const stray = owns("edge_teryt0201_pks_seat", { type: "comment" });
      expect(
        planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
          seatsOfCompany: [],
          takenBy: stray,
        }),
      ).toEqual({
        action: "skip",
        reason: "edge_teryt0201_pks_seat is already held by a comment edge",
        others: ["edge_teryt0201_pks_seat"],
      });
    });
  });

  it("drops a random-id copy beside a random-id seat as well", () => {
    // No id collides, but retyping would still give the pair two seats.
    const twin = seat("8R074ZNdYEK0zvbgoPm7");
    expect(
      planSeat(owns("Twm20atuwEHkzrNq8hMe"), BEFORE, {
        seatsOfCompany: [twin],
      }),
    ).toEqual({ action: "drop", into: "8R074ZNdYEK0zvbgoPm7" });
  });

  it("skips a pair with several seats", () => {
    const seats = [seat("a"), seat("b")];
    expect(
      planSeat(owns("Twm20atuwEHkzrNq8hMe"), BEFORE, { seatsOfCompany: seats }),
    ).toEqual({
      action: "skip",
      reason: "2 seats are already stored for this pair",
      others: ["a", "b"],
    });
  });

  it("skips a company already seated in another region", () => {
    // Retyping would give it two seats; which is right is fix-stale-seats'
    // question, not this script's.
    const elsewhere = seat("edge_teryt2469_pks_seat", { source: "teryt2469" });
    expect(
      planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
        seatsOfCompany: [elsewhere],
      }),
    ).toEqual({
      action: "skip",
      reason: "the company is already seated in teryt2469",
      others: ["edge_teryt2469_pks_seat"],
    });
  });

  it("does not count a removed seat elsewhere as a competing claim", () => {
    const removed = seat("edge_teryt2469_pks_seat", {
      source: "teryt2469",
      deleted: true,
    });
    expect(
      planSeat(owns("edge_teryt0201_pks_owns"), BEFORE, {
        seatsOfCompany: [removed],
      }),
    ).toEqual({ action: "move", newId: "edge_teryt0201_pks_seat" });
  });
});

describe("differences", () => {
  it("ignores the type and each copy's own revision pointer", () => {
    expect(differences(owns("x"), seat("y"))).toEqual([]);
  });

  it("names every field the two disagree about", () => {
    expect(
      differences(
        owns("x", { start_date: "2020-01-01", references: ["a"] }),
        seat("y", { references: ["b"] }),
      ),
    ).toEqual(["references", "start_date"]);
  });

  it("compares a reference by its path and a timestamp by its instant", () => {
    const ref = (path: string) => ({ path, firestore: {} });
    const at = (iso: string) => ({ toDate: () => new Date(iso) });
    expect(
      differences(
        owns("x", {
          source_ref: ref("nodes/a"),
          at: at("2026-01-01T00:00:00Z"),
        }),
        seat("y", {
          source_ref: ref("nodes/a"),
          at: at("2026-01-01T00:00:00Z"),
        }),
      ),
    ).toEqual([]);
    expect(
      differences(
        owns("x", { source_ref: ref("nodes/a") }),
        seat("y", { source_ref: ref("nodes/b") }),
      ),
    ).toEqual(["source_ref"]);
  });
});

describe("edgeCreatedAt", () => {
  it("is the earliest revision, whatever shape its time is stored in", () => {
    expect(
      edgeCreatedAt([
        "2026-09-13T16:53:38.116Z",
        { toDate: () => new Date("2026-08-21T13:00:00Z") },
        { _seconds: Date.parse("2026-08-24T16:00:00Z") / 1000 },
      ]),
    ).toBe(BEFORE);
  });

  it("is null when nothing dates the edge", () => {
    expect(edgeCreatedAt([])).toBeNull();
    expect(edgeCreatedAt([null, undefined, "not a date"])).toBeNull();
  });
});

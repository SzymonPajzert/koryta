import { describe, it, expect } from "vitest";
import { computeRevisionsObj } from "../../shared/revisions";

describe("computeRevisionsObj", () => {
  it("should return null if there are no revisions", () => {
    const result = computeRevisionsObj("some-id", []);
    expect(result).toBeNull();
  });

  it("should correctly compute total and latest time", () => {
    const revisions = [
      { id: "rev1", update_time: "2026-07-09T10:00:00Z" },
      { id: "rev2", update_time: "2026-07-09T12:00:00Z" }, // Latest
      { id: "rev3", update_time: "2026-07-09T09:00:00Z" },
    ];
    const result = computeRevisionsObj(null, revisions);
    expect(result).not.toBeNull();
    expect(result?.total).toBe(3);
    expect(result?.latest_id).toBe("rev2");
    expect(result?.latest_time).toBe("2026-07-09T12:00:00Z");
  });

  it("should set has_unapproved to false if the latest revision is the approved one", () => {
    const revisions = [
      { id: "rev1", update_time: "2026-07-09T10:00:00Z" },
      { id: "rev2", update_time: "2026-07-09T12:00:00Z" }, // Latest and approved
    ];
    // Testing string path
    const result = computeRevisionsObj("revisions/rev2", revisions);
    expect(result?.has_unapproved).toBe(false);
  });

  it("should set has_unapproved to true if there is a newer revision than the approved one", () => {
    const revisions = [
      { id: "rev1", update_time: "2026-07-09T10:00:00Z" }, // Approved, but older
      { id: "rev2", update_time: "2026-07-09T12:00:00Z" }, // Latest, unapproved
    ];

    // Node is approved on rev1
    const result = computeRevisionsObj("revisions/rev1", revisions);
    expect(result?.has_unapproved).toBe(true);
  });

  it("should parse complex object paths for nodeRevisionId correctly", () => {
    const revisions = [{ id: "rev2", update_time: "2026-07-09T12:00:00Z" }];

    // Testing object { path: ... }
    let result = computeRevisionsObj({ path: "revisions/rev2" }, revisions);
    expect(result?.has_unapproved).toBe(false);

    // Testing _path.segments
    result = computeRevisionsObj(
      { _path: { segments: ["revisions", "rev1"] } },
      revisions,
    );
    expect(result?.has_unapproved).toBe(true);
  });

  it("should set has_unapproved to false if nodeRevisionId is null (not approved at all)", () => {
    const revisions = [{ id: "rev2", update_time: "2026-07-09T12:00:00Z" }];

    const result = computeRevisionsObj(null, revisions);
    expect(result?.has_unapproved).toBe(false);
  });
});

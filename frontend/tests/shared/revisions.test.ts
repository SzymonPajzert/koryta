import { describe, it, expect } from "vitest";
import {
  computeRevisionsObj,
  latestPublishableRevision,
} from "../../shared/revisions";

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

  it("should set has_unapproved to true if nodeRevisionId is null (not approved at all)", () => {
    const revisions = [{ id: "rev2", update_time: "2026-07-09T12:00:00Z" }];

    const result = computeRevisionsObj(null, revisions);
    expect(result?.has_unapproved).toBe(true);
  });
});

describe("latestPublishableRevision", () => {
  const node = (extra: Record<string, unknown>) => ({
    data: { name: "X" },
    ...extra,
  });

  it("picks the newest revision", () => {
    const result = latestPublishableRevision([
      node({ id: "old", update_time: "2026-07-09T10:00:00Z" }),
      node({ id: "new", update_time: "2026-07-09T12:00:00Z" }),
    ]);

    expect(result?.id).toBe("new");
  });

  it("reads a Firestore timestamp as readily as an ISO string", () => {
    // Which one a revision carries depends on the writer, so comparing them
    // raw ordered every timestamp above every string regardless of date.
    const result = latestPublishableRevision([
      node({ id: "iso", update_time: "2026-07-09T12:00:00Z" }),
      node({
        id: "stamp",
        update_time: { toDate: () => new Date("2026-07-09T10:00:00Z") },
      }),
    ]);

    expect(result?.id).toBe("iso");
  });

  it("skips a revision somebody turned down", () => {
    // Publishing means showing the newest version anybody would stand behind,
    // and a rejected one is precisely the version somebody would not.
    const result = latestPublishableRevision([
      node({ id: "kept", update_time: "2026-07-09T10:00:00Z" }),
      node({
        id: "rejected",
        update_time: "2026-07-09T12:00:00Z",
        status: "rejected",
      }),
    ]);

    expect(result?.id).toBe("kept");
  });

  it("skips a proposal to remove the page", () => {
    // `deleted` is not a field the node owns while it is still there, so
    // applying this one would take the page down in the act of putting it up.
    const result = latestPublishableRevision([
      node({ id: "kept", update_time: "2026-07-09T10:00:00Z" }),
      {
        id: "removal",
        update_time: "2026-07-09T12:00:00Z",
        data: { name: "X", deleted: true },
      },
    ]);

    expect(result?.id).toBe("kept");
  });

  it("skips a revision with nothing to apply, and edge revisions", () => {
    const result = latestPublishableRevision([
      node({ id: "kept", update_time: "2026-07-09T10:00:00Z" }),
      { id: "empty", update_time: "2026-07-09T12:00:00Z" },
      {
        id: "edge",
        update_time: "2026-07-09T13:00:00Z",
        data: { source: "a", target: "b" },
      },
    ]);

    expect(result?.id).toBe("kept");
  });

  it("has nothing to offer when every revision is unusable", () => {
    const result = latestPublishableRevision([
      node({ id: "rejected", status: "rejected" }),
    ]);

    expect(result).toBeNull();
  });

  it("breaks a tie the same way every time", () => {
    // An ingest writes a batch within one millisecond; the button names a
    // revision and the server approves one, and they have to be the same one.
    const revisions = [
      node({ id: "a", update_time: "2026-07-09T10:00:00Z" }),
      node({ id: "b", update_time: "2026-07-09T10:00:00Z" }),
    ];

    expect(latestPublishableRevision(revisions)?.id).toBe("b");
    expect(latestPublishableRevision([...revisions].reverse())?.id).toBe("b");
  });
});

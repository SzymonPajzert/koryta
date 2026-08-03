import { describe, it, expect } from "vitest";
import {
  approvedRevisionId,
  pageIsPublic,
  revisionCollection,
  revisionIsPending,
} from "../../shared/model";

describe("pageIsPublic", () => {
  it("reads the explicit flag when there is one", () => {
    expect(pageIsPublic({ published: true })).toBe(true);
    expect(pageIsPublic({ published: false })).toBe(false);
  });

  it("falls back to the approved revision for documents written before it", () => {
    // /api/nodes/migratePublished backfills these; until it has run, an
    // approved page has to keep being treated as a public one.
    expect(pageIsPublic({ revision_id: "revisions/r1" })).toBe(true);
    expect(pageIsPublic({})).toBe(false);
  });

  it("an unpublished page stays hidden even with an approved revision", () => {
    expect(
      pageIsPublic({ published: false, revision_id: "revisions/r1" }),
    ).toBe(false);
  });

  it("an approved removal outranks everything", () => {
    expect(
      pageIsPublic({ deleted: true, published: true, revision_id: "r1" }),
    ).toBe(false);
  });
});

describe("revisionCollection", () => {
  it("uses the recorded collection", () => {
    expect(revisionCollection({ collection: "edges", data: {} })).toBe("edges");
    expect(revisionCollection({ collection: "nodes", data: {} })).toBe("nodes");
  });

  it("infers edges from a revision carrying both ends of a link", () => {
    // `node_id` is the target's id whatever the target is, so the shape of the
    // data is all the older revisions left to go on.
    expect(
      revisionCollection({ data: { source: "a", target: "b", type: "owns" } }),
    ).toBe("edges");
  });

  it("infers nodes for anything else", () => {
    expect(revisionCollection({ data: { name: "Jan", type: "person" } })).toBe(
      "nodes",
    );
    expect(revisionCollection({})).toBe("nodes");
  });
});

describe("revisionIsPending", () => {
  it("treats a revision written before statuses existed as waiting", () => {
    expect(revisionIsPending({})).toBe(true);
  });

  it("is done with a reviewed one either way", () => {
    expect(revisionIsPending({ status: "approved" })).toBe(false);
    expect(revisionIsPending({ status: "rejected" })).toBe(false);
    expect(revisionIsPending({ status: "pending" })).toBe(true);
  });
});

describe("approvedRevisionId", () => {
  it("reads every shape a revision_id arrives in", () => {
    expect(approvedRevisionId("revisions/r1")).toBe("r1");
    expect(approvedRevisionId({ path: "revisions/r1" })).toBe("r1");
    expect(approvedRevisionId({ id: "r1" })).toBe("r1");
    expect(approvedRevisionId(undefined)).toBeUndefined();
    expect(approvedRevisionId(null)).toBeUndefined();
  });
});

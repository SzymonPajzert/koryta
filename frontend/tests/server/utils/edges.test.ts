import { describe, it, expect } from "vitest";
import {
  edgeDocumentId,
  edgeIdentity,
  findEdge,
  type EdgeLike,
} from "../../../server/utils/edges";

const link: EdgeLike = { source: "a", target: "b", type: "owns" };

describe("edgeIdentity", () => {
  it("treats an absent field and an explicit null as the same", () => {
    expect(edgeIdentity(link)).toBe(edgeIdentity({ ...link, name: null }));
  });

  it("separates edges that differ in a detail field", () => {
    expect(edgeIdentity({ ...link, start_date: "2020-01-01" })).not.toBe(
      edgeIdentity(link),
    );
  });

  it("ignores fields that do not identify the edge", () => {
    // `revision_id` says whether the edge is published, not what it asserts.
    expect(edgeIdentity({ ...link, revision_id: "rev-1" })).toBe(
      edgeIdentity(link),
    );
  });
});

describe("edgeDocumentId", () => {
  it("keeps the plain form for a link that is only its two ends", () => {
    expect(edgeDocumentId({ source: "teryt1061", target: "c1", type: "owns" }))
      // The scheme the region pipeline and the company ingest already use.
      .toBe("edge_teryt1061_c1_owns");
  });

  it("is stable for the same edge", () => {
    const edge = { ...link, type: "employed", name: "prezes" };
    expect(edgeDocumentId(edge)).toBe(edgeDocumentId({ ...edge }));
  });

  it("separates two posts between the same pair", () => {
    // The case the old lookup collapsed: same person, same company, twice.
    const first = { ...link, type: "employed", start_date: "2002-12-20" };
    const second = { ...link, type: "employed", start_date: "2025-01-10" };
    expect(edgeDocumentId(first)).not.toBe(edgeDocumentId(second));
  });

  it("produces an id Firestore will accept", () => {
    const id = edgeDocumentId({
      ...link,
      type: "election",
      position: "Rada miasta",
      name: "kandydatura",
    });
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(100);
  });
});

describe("findEdge", () => {
  function dbWith(stored: EdgeLike[]) {
    return {
      collection: () => ({
        where: function () {
          return this;
        },
        get: async () => ({
          docs: stored.map((edge, index) => ({
            id: `stored-${index}`,
            data: () => edge,
          })),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore;
  }

  it("finds an edge asserting exactly the same thing", async () => {
    await expect(findEdge(dbWith([link]), link)).resolves.toBe("stored-0");
  });

  it("does not match an edge that differs in a detail", async () => {
    const stored = { ...link, start_date: "2020-01-01" };
    await expect(findEdge(dbWith([stored]), link)).resolves.toBeUndefined();
  });

  it("picks the matching edge out of several between the same pair", async () => {
    const other = { ...link, start_date: "2020-01-01" };
    await expect(findEdge(dbWith([other, link]), link)).resolves.toBe(
      "stored-1",
    );
  });
});

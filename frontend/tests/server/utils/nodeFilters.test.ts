import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStructuralFilterOps } from "../../../server/utils/nodeFilters";

const { mockFetchNodes, mockGet, mockWhere, mockCollection } = vi.hoisted(
  () => {
    const mockGet = vi.fn();
    const mockWhere = vi.fn().mockReturnThis();
    const mockCollection = vi.fn().mockReturnValue({
      where: mockWhere,
      limit: vi.fn().mockReturnThis(),
      get: mockGet,
    });
    return {
      mockFetchNodes: vi.fn(),
      mockGet,
      mockWhere,
      mockCollection,
    };
  },
);

vi.mock("~~/server/utils/fetch", () => ({
  fetchNodes: mockFetchNodes,
  applyPartiesFilter: (q: unknown) => q,
}));

const db = {
  collection: mockCollection,
} as unknown as FirebaseFirestore.Firestore;

/** All region nodes the mocked database knows about. */
const regions = {
  teryt14: { teryt: "14", name: "Województwo mazowieckie" },
  teryt1425: { teryt: "1425", name: "Radom" },
  teryt1465: { teryt: "1465", name: "Warszawa" },
  teryt1465011: { teryt: "1465011", name: "Śródmieście" },
  teryt12: { teryt: "12", name: "małopolskie" },
  teryt1261: { teryt: "1261", name: "Kraków" },
};

/** A Firestore query stub that records the clause it was given. */
function stubQuery() {
  return {
    where: (field: string, op: string, value: unknown) => ({
      field,
      op,
      value,
    }),
  } as unknown as FirebaseFirestore.Query;
}

/** A person node connected to the given region ids. */
function person(id: string, targetNodeIds: string[]) {
  return {
    id,
    stats: { edges: { approved: { targetNodeIds } } },
  };
}

describe("buildStructuralFilterOps, teryt filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchNodes.mockResolvedValue(regions);
  });

  it("expands a województwo code to every region inside it", async () => {
    const { ops, empty } = await buildStructuralFilterOps(
      db,
      { teryt: "14" },
      "approved",
    );
    expect(empty).toBe(false);
    expect(ops).toHaveLength(1);

    const nodes = [
      person("sejmik", ["teryt14"]),
      person("radom", ["teryt1425"]),
      person("srodmiescie", ["teryt1465011"]),
      person("krakow", ["teryt1261"]),
      person("nowhere", []),
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual([
      "sejmik",
      "radom",
      "srodmiescie",
    ]);
  });

  it("keeps a powiat code exact, without pulling in the whole województwo", async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ id: "teryt1425" }],
    });

    const { ops, empty } = await buildStructuralFilterOps(
      db,
      { teryt: "1425" },
      "approved",
    );
    expect(empty).toBe(false);
    expect(mockWhere).toHaveBeenCalledWith("teryt", "==", "1425");
    // The exact lookup must not fall back to reading every region.
    expect(mockFetchNodes).not.toHaveBeenCalled();

    const nodes = [
      person("radom", ["teryt1425"]),
      person("sejmik", ["teryt14"]),
      person("warszawa", ["teryt1465"]),
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual(["radom"]);
  });

  it("reports an empty result set for an unknown powiat", async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    const { empty } = await buildStructuralFilterOps(
      db,
      { teryt: "9999" },
      "approved",
    );
    expect(empty).toBe(true);
  });

  it("reports an empty result set for a województwo with no regions", async () => {
    mockFetchNodes.mockResolvedValue({});
    const { empty } = await buildStructuralFilterOps(
      db,
      { teryt: "14" },
      "approved",
    );
    expect(empty).toBe(true);
  });

  it("runs in memory once the region set is too big for array-contains-any", async () => {
    const { ops } = await buildStructuralFilterOps(
      db,
      { teryt: "14" },
      "approved",
    );
    // Four regions sit in województwo 14, which fits Firestore's ten value
    // limit, so the filter can still be pushed down.
    expect(ops[0]!.applyFs(stubQuery())).toEqual({
      field: "stats.edges.approved.targetNodeIds",
      op: "array-contains-any",
      value: ["teryt14", "teryt1425", "teryt1465", "teryt1465011"],
    });

    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `teryt14${String(i).padStart(2, "0")}`,
        { teryt: `14${String(i).padStart(2, "0")}`, name: `Powiat ${i}` },
      ]),
    );
    mockFetchNodes.mockResolvedValue(many);
    const big = await buildStructuralFilterOps(db, { teryt: "14" }, "approved");
    expect(() => big.ops[0]!.applyFs(stubQuery())).toThrowError(/index/);
  });

  it("honours the currentlyEmployed scope when filtering by województwo", async () => {
    const { ops } = await buildStructuralFilterOps(
      db,
      { teryt: "14", currentlyEmployed: "selected" },
      "approved",
    );

    const nodes = [
      {
        id: "past",
        stats: {
          edges: {
            approved: {
              targetNodeIds: ["teryt1425"],
              currentlyEmployedTargetNodeIds: [],
            },
          },
        },
      },
      {
        id: "current",
        stats: {
          edges: {
            approved: {
              targetNodeIds: ["teryt1425"],
              currentlyEmployedTargetNodeIds: ["teryt1425"],
            },
          },
        },
      },
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual(["current"]);
  });
});

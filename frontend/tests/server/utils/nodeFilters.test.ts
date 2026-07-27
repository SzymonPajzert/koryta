import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStructuralFilterOps } from "../../../server/utils/nodeFilters";

const { mockFetchNodes, mockGet, mockWhere, mockCollection } = vi.hoisted(
  () => {
    // Queries are answered per collection, since one call to
    // buildStructuralFilterOps can hit `nodes` (regions, companies by KRS) and
    // `edges` (company locations) in the same pass.
    const mockGet = vi.fn();
    const mockWhere = vi.fn();
    const mockCollection = vi.fn();
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

/** Region -> company `owns` edges, the way company locations are stored. */
const locationEdges = [
  { source: "teryt1465", target: "szpitalWarszawa", type: "owns" },
  { source: "teryt1425", target: "szpitalRadom", type: "owns" },
  { source: "teryt1465", target: "wodociagiWarszawa", type: "owns" },
  { source: "teryt1261", target: "szpitalKrakow", type: "owns" },
  // Region hierarchy edges share the collection and must be ignored.
  { source: "teryt14", target: "teryt1465", type: "owns" },
];

/** Wires the mocked Firestore up for one test. */
function mockDb({
  regionByTeryt,
  placesByKrs = [],
}: {
  regionByTeryt?: string;
  placesByKrs?: string[];
} = {}) {
  mockCollection.mockImplementation((name: string) => {
    const clauses: { field: string; op: string; value: unknown }[] = [];
    const query: Record<string, unknown> = {};
    query.where = (field: string, op: string, value: unknown) => {
      clauses.push({ field, op, value });
      mockWhere(field, op, value);
      return query;
    };
    query.limit = () => query;
    query.get = () => {
      mockGet(name, clauses);
      if (name === "edges") {
        const chunk = clauses.find((c) => c.field === "source")
          ?.value as string[];
        const docs = locationEdges
          .filter((e) => chunk.includes(e.source))
          .map((e) => ({ data: () => e }));
        return Promise.resolve({ docs, empty: docs.length === 0 });
      }
      // `nodes`: either an exact region lookup or companies by KRS.
      if (clauses.some((c) => c.field === "teryt")) {
        return Promise.resolve(
          regionByTeryt
            ? { empty: false, docs: [{ id: regionByTeryt }] }
            : { empty: true, docs: [] },
        );
      }
      return Promise.resolve({
        empty: placesByKrs.length === 0,
        docs: placesByKrs.map((id) => ({ id })),
      });
    };
    return query;
  });
}

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
    mockDb();
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
    mockDb({ regionByTeryt: "teryt1425" });

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
    mockDb();
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

describe("buildStructuralFilterOps, company level filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchNodes.mockImplementation((type: string) =>
      Promise.resolve(
        type === "region"
          ? regions
          : {
              szpitalWarszawa: { categories: ["szpitale"] },
              szpitalRadom: { categories: ["szpitale"] },
              szpitalKrakow: { categories: ["szpitale"] },
              wodociagiWarszawa: { categories: ["wodociagi"] },
            },
      ),
    );
    mockDb();
  });

  /** A person connected to the given company ids. */
  const worker = (id: string, companies: string[]) => ({
    id,
    stats: { edges: { approved: { targetNodeIds: companies } } },
  });

  it("matches people at a company seated in the województwo", async () => {
    const { ops, empty } = await buildStructuralFilterOps(
      db,
      { companyTeryt: "14" },
      "approved",
    );
    expect(empty).toBe(false);

    const nodes = [
      worker("warszawa", ["szpitalWarszawa"]),
      worker("radom", ["szpitalRadom"]),
      worker("krakow", ["szpitalKrakow"]),
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual([
      "warszawa",
      "radom",
    ]);
  });

  it("ignores the region hierarchy edges sharing the edges collection", async () => {
    const { ops } = await buildStructuralFilterOps(
      db,
      { companyTeryt: "14" },
      "approved",
    );
    // teryt14 -> teryt1465 is an `owns` edge too, but a region is not a place.
    expect(ops[0]!.applyMem([worker("region", ["teryt1465"])])).toEqual([]);
  });

  it("intersects category with company location instead of crossing them", async () => {
    const { ops, empty } = await buildStructuralFilterOps(
      db,
      { category: "szpitale", companyTeryt: "14" },
      "approved",
    );
    expect(empty).toBe(false);
    // One op, not two: both constrain the same company.
    expect(ops).toHaveLength(1);

    const nodes = [
      worker("atMazHospital", ["szpitalWarszawa"]),
      // The case this whole change is about: a hospital elsewhere plus an
      // unrelated mazowieckie company must NOT match.
      worker("krakowHospitalPlusMazWater", [
        "szpitalKrakow",
        "wodociagiWarszawa",
      ]),
      worker("mazWaterOnly", ["wodociagiWarszawa"]),
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual(["atMazHospital"]);
  });

  it("intersects KRS with category as well", async () => {
    mockDb({ placesByKrs: ["szpitalWarszawa", "wodociagiWarszawa"] });
    const { ops } = await buildStructuralFilterOps(
      db,
      { krs: ["0000000001", "0000000002"], category: "szpitale" },
      "approved",
    );
    expect(ops).toHaveLength(1);
    const nodes = [
      worker("hospital", ["szpitalWarszawa"]),
      worker("water", ["wodociagiWarszawa"]),
    ];
    expect(ops[0]!.applyMem(nodes).map((n) => n.id)).toEqual(["hospital"]);
  });

  it("reports an empty result set when the intersection is empty", async () => {
    const { empty } = await buildStructuralFilterOps(
      db,
      { category: "wodociagi", companyTeryt: "12" },
      "approved",
    );
    expect(empty).toBe(true);
  });

  it("keeps the person level teryt filter independent of the company one", async () => {
    const { ops } = await buildStructuralFilterOps(
      db,
      { companyTeryt: "14", teryt: "12" },
      "approved",
    );
    // Two ops: one about the employer, one about the person's own region ties.
    expect(ops).toHaveLength(2);
  });
});

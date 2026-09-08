import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildClusterHires,
  CLUSTER_METHOD_VERSION,
  clusterStatsAreStale,
  ensureClusterStats,
  type ClusterStatsDoc,
} from "../../../server/utils/clusterStats";

const { mockDocGet, mockDocSet, mockFetchNodes, mockWhere } = vi.hoisted(
  () => ({
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn(),
    mockFetchNodes: vi.fn(),
    mockWhere: vi.fn(),
  }),
);

vi.mock("~~/server/utils/fetch", () => ({ fetchNodes: mockFetchNodes }));

const db = {
  collection: (name: string) => ({
    doc: () => ({ get: mockDocGet, set: mockDocSet }),
    where: (...args: unknown[]) => {
      mockWhere(name, ...args);
      // `.select()` projects the query; the chain has to answer it.
      const query = {
        select: () => query,
        get: async () => ({ docs: [] }),
      };
      return query;
    },
  }),
} as unknown as FirebaseFirestore.Firestore;

const NOW = new Date("2026-09-07T12:00:00.000Z");

const stored = (computedAt: string): ClusterStatsDoc => ({
  type: "employment_clusters",
  clusters: [],
  computedAt,
  windowStart: "2024-09-08",
  windowEnd: "2026-09-07",
  hiresConsidered: 4039,
  hiresVisible: 249,
  unpaidSeatsExcluded: 3866,
  version: CLUSTER_METHOD_VERSION,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDocSet.mockResolvedValue(undefined);
  mockFetchNodes.mockResolvedValue({});
});

describe("clusterStatsAreStale", () => {
  it("treats a missing document, and one a day old, as stale", () => {
    expect(clusterStatsAreStale(null, NOW)).toBe(true);
    expect(clusterStatsAreStale(stored("2026-09-06T11:00:00.000Z"), NOW)).toBe(
      true,
    );
    expect(clusterStatsAreStale(stored("2026-09-07T02:00:00.000Z"), NOW)).toBe(
      false,
    );
  });

  it("treats an unreadable timestamp as stale rather than as fresh forever", () => {
    expect(clusterStatsAreStale(stored("nie wiadomo kiedy"), NOW)).toBe(true);
  });
});

describe("ensureClusterStats", () => {
  it("serves a fresh document without reading the graph", async () => {
    const doc = stored("2026-09-07T02:00:00.000Z");
    mockDocGet.mockResolvedValue({ exists: true, data: () => doc });

    expect(await ensureClusterStats(db, NOW)).toEqual(doc);
    expect(mockFetchNodes).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it("hands back the stale document at once and rebuilds behind the response", async () => {
    const doc = stored("2026-09-01T02:00:00.000Z");
    mockDocGet.mockResolvedValue({ exists: true, data: () => doc });

    // The reader gets yesterday's answer rather than waiting for a scan of
    // 38,000 edges.
    expect(await ensureClusterStats(db, NOW)).toEqual(doc);
    // ...and the scan still happens.
    await vi.waitFor(() => expect(mockDocSet).toHaveBeenCalledTimes(1));
    expect(mockFetchNodes).toHaveBeenCalledWith("person");
  });

  it("recomputes a document written by an older detector", async () => {
    const old = { ...stored("2026-09-07T02:00:00.000Z"), version: 0 };
    mockDocGet.mockResolvedValue({ exists: true, data: () => old });

    const doc = await ensureClusterStats(db, NOW);

    expect(doc?.version).toBe(CLUSTER_METHOD_VERSION);
    expect(mockDocSet).toHaveBeenCalledTimes(1);
  });

  it("blocks and builds when there is nothing stored at all", async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const doc = await ensureClusterStats(db, NOW);

    expect(doc?.type).toBe("employment_clusters");
    expect(doc?.clusters).toEqual([]);
    expect(doc?.windowEnd).toBe("2026-09-07");
    expect(mockDocSet).toHaveBeenCalledTimes(1);
    // Four queries, one per edge type, rather than the whole collection.
    expect(mockWhere.mock.calls.map((call) => call[3])).toEqual([
      "employed",
      "seat",
      "owns",
      "election",
    ]);
  });

  it("does not start a second rebuild while one is running", async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    await Promise.all([
      ensureClusterStats(db, NOW),
      ensureClusterStats(db, NOW),
      ensureClusterStats(db, NOW),
    ]);

    expect(mockDocSet).toHaveBeenCalledTimes(1);
  });

  it("serves what it has when the rebuild throws", async () => {
    const doc = stored("2026-09-01T02:00:00.000Z");
    mockDocGet.mockResolvedValue({ exists: true, data: () => doc });
    mockFetchNodes.mockRejectedValue(new Error("firestore down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await ensureClusterStats(db, NOW)).toEqual(doc);
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    logged.mockRestore();
  });
});

describe("what reaches the detector", () => {
  it("counts a supervisory seat at a company whose organ nobody recorded", async () => {
    /* 773 places carry no `supervisoryOrgan` at all. Reading that as "not a
     * rada nadzorcza" dropped every supervisory seat at all of them - 901 in
     * the window - which is the wrong direction: `bodyIsPaidPost` says an
     * unread entry counts. */
    mockFetchNodes.mockImplementation(async (type: string) => {
      if (type === "person") {
        return {
          p1: { type: "person", name: "Jan Kowalski", published: true },
        };
      }
      if (type === "place") {
        return {
          c1: { type: "place", name: "SPÓŁKA", published: true },
          c2: {
            type: "place",
            name: "SZPITAL",
            published: true,
            supervisoryOrgan: "rada_spoleczna",
          },
        };
      }
      return {};
    });
    const edges = [
      {
        id: "e1",
        type: "employed",
        source: "p1",
        target: "c1",
        name: "Rada Nadzorcza",
        start_date: "2026-05-01",
      },
      {
        id: "e2",
        type: "employed",
        source: "p1",
        target: "c2",
        name: "Rada Nadzorcza",
        start_date: "2026-05-01",
      },
    ];
    const withEdges = {
      collection: () => ({
        doc: () => ({ get: mockDocGet, set: mockDocSet }),
        where: (_f: string, _op: string, type: string) => {
          const query = {
            select: () => query,
            get: async () => ({
              docs:
                type === "employed"
                  ? edges.map((e) => ({ id: e.id, data: () => e }))
                  : [],
            }),
          };
          return query;
        },
      }),
    } as unknown as FirebaseFirestore.Firestore;

    const { hires, unpaidSeats } = await buildClusterHires(withEdges);

    expect(hires.map((hire) => hire.companyId)).toEqual(["c1"]);
    expect(unpaidSeats).toBe(1);
  });
});

describe("the stored document", () => {
  it("stays well inside Firestore's one-megabyte limit", async () => {
    /* Sixty clusters of twenty-five hires each, every string at the length the
     * real graph produces - the longest company name on the site is 62
     * characters and the longest region name 38. A document that grew past a
     * megabyte would be refused outright, and the failure would be a home page
     * with no section rather than a warning. */
    const longCompany =
      "WOJEWÓDZKI SZPITAL SPECJALISTYCZNY IM. JANUSZA KORCZAKA";
    const clusters = Array.from({ length: 60 }, (_, c) => ({
      id: `region:teryt${c}`,
      kind: "region" as const,
      key: `teryt${c}`,
      title: "Powiat tomaszowski (Tomaszów Mazowiecki)",
      known: 40,
      visible: 20,
      companies: 12,
      expected: 12.5,
      partyMix: { PiS: 10, PO: 6, PSL: 3, "Nowa Lewica": 2 },
      dominantParty: "PiS",
      dominantCount: 10,
      labelled: 21,
      partyP: 1e-5,
      partyQ: 1e-4,
      partyLift: 2.5,
      partyLiftLow: 1.6,
      partyPUnpublished: 0.01,
      partyIsEditorialArtifact: false,
      channels: ["party", "burst"] as const,
      burstP: 1e-4,
      burstQ: 1e-3,
      burstLift: 1.9,
      burstLiftLow: 1.4,
      swept: 5,
      sweepExpected: 3.2,
      sweepP: 0.01,
      sweepQ: 0.04,
      sweepLift: 1.6,
      sweepLiftLow: 1.2,
      rolloutPerMonth: 0.5,
      localCandidates: 14,
      localExpected: 8.8,
      localP: 0.02,
      localQ: 0.08,
      localLift: 1.6,
      localLiftLow: 1.1,
      crew: Array.from({ length: 6 }, (_, i) => ({
        personId: `person-${c}-${i}`,
        personName: "Małgorzata Grzywaczewska-Kowalska",
        companies: 3,
        parties: ["PiS", "PSL"],
      })),
      sectors: [
        { category: "szpitale", count: 12 },
        { category: "wodociagi", count: 6 },
      ],
      hires: Array.from({ length: 25 }, (_, i) => ({
        edgeId: `edge-${c}-${i}`,
        personId: `person-${c}-${i}`,
        personName: "Małgorzata Grzywaczewska-Kowalska",
        parties: ["PiS", "PSL"],
        companyId: `company-${c}-${i}`,
        companyName: longCompany,
        role: "Przewodniczący Rady Nadzorczej",
        start: "2026-05-12",
        visible: i % 2 === 0,
        localCandidate: true,
      })),
      firstStart: "2024-10-01",
      lastStart: "2026-08-13",
      score: 3.2,
    }));

    const bytes = Buffer.byteLength(JSON.stringify(clusters), "utf8");
    expect(bytes).toBeLessThan(700_000);
  });
});

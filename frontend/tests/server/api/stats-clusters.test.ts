import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/stats/clusters.get";
import type { StoryCluster } from "../../../shared/clusters";

const { mockEnsure, mockGetOptionalUser, mockQuery } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.defineEventHandler = (fn: unknown) => fn;
  globals.defineCachedEventHandler = (fn: unknown) => fn;
  globals.defineCachedFunction = (fn: unknown) => fn;
  globals.useEvent = () => ({ path: "/api/stats/clusters" });
  globals.setResponseHeader = () => undefined;
  const query = { limit: 12 } as Record<string, unknown>;
  globals.getValidatedQuery = async (
    _event: unknown,
    parse: (q: unknown) => unknown,
  ) => parse(query);

  return {
    mockEnsure: vi.fn(),
    mockGetOptionalUser: vi.fn(),
    mockQuery: query,
  };
});

vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));
vi.mock("~~/server/utils/clusterStats", () => ({
  ensureClusterStats: mockEnsure,
}));
vi.mock("~~/server/utils/auth", () => ({
  getOptionalUser: mockGetOptionalUser,
}));

// The handler is wrapped in nitro's cache; here it runs straight through.
vi.mock("~~/server/utils/handlers", () => ({
  editorFreshCachedEventHandler: (fn: unknown) => fn,
}));

const call = () =>
  (handler as unknown as (event: unknown) => Promise<Record<string, unknown>>)(
    {},
  );

function cluster(overrides: Partial<StoryCluster> = {}): StoryCluster {
  return {
    id: "region:teryt0662",
    kind: "region",
    key: "teryt0662",
    title: "Chełm",
    known: 20,
    visible: 12,
    companies: 8,
    expected: 10,
    partyMix: { PiS: 10 },
    dominantParty: "PiS",
    dominantCount: 10,
    labelled: 14,
    partyP: 0.0001,
    partyQ: 0.008,
    partyLift: 3,
    partyLiftLow: 2,
    burstP: 0.001,
    burstQ: 0.01,
    burstLift: 1.9,
    burstLiftLow: 1.3,
    swept: 4,
    sweepExpected: 3.3,
    sweepP: 1,
    sweepQ: 1,
    sweepLift: 0,
    sweepLiftLow: 0,
    rolloutPerMonth: 0.17,
    localCandidates: 10,
    localExpected: 5,
    localP: 0.02,
    localQ: 0.1,
    localLift: 2,
    localLiftLow: 1.2,
    density: 0,
    densityOf: 0,
    densityExpected: 0,
    densityP: 1,
    densityQ: 1,
    densityLift: 0,
    densityLiftLow: 0,
    partyPUnpublished: 0.004,
    partyIsEditorialArtifact: false,
    channels: ["party", "burst"],
    crew: [
      {
        personId: "p1",
        personName: "Artur Juszczak",
        companies: 3,
        parties: ["PiS"],
      },
      {
        personId: "p9",
        personName: "Nieopublikowany",
        companies: 2,
        parties: [],
      },
    ],
    sectors: [{ category: "sport", count: 4 }],
    hires: [
      {
        edgeId: "e1",
        personId: "p1",
        personName: "Artur Juszczak",
        parties: ["PiS"],
        companyId: "c1",
        companyName: "SPÓŁKA",
        role: "Zarząd",
        start: "2026-08-13",
        visible: true,
        localCandidate: true,
      },
      {
        edgeId: "e2",
        personId: "p9",
        personName: "Nieopublikowany",
        parties: [],
        companyId: "c2",
        companyName: "INNA SPÓŁKA",
        role: "Rada Nadzorcza",
        start: "2026-07-01",
        visible: false,
        localCandidate: false,
      },
    ],
    firstStart: "2025-01-01",
    lastStart: "2026-08-13",
    score: 5.8,
    ...overrides,
  };
}

const doc = (clusters: StoryCluster[]) => ({
  type: "employment_clusters" as const,
  clusters,
  computedAt: "2026-09-07T02:00:00.000Z",
  windowStart: "2024-09-08",
  windowEnd: "2026-09-07",
  hiresConsidered: 4039,
  hiresVisible: 249,
  unpaidSeatsExcluded: 3866,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.limit = 12;
  delete mockQuery.kind;
  mockGetOptionalUser.mockResolvedValue(null);
});

describe("/api/stats/clusters", () => {
  it("hides the draft hires and the draft crew from a logged out reader", async () => {
    mockEnsure.mockResolvedValue(doc([cluster()]));

    const response = await call();
    const [first] = response.clusters as StoryCluster[];

    expect(first!.hires).toHaveLength(1);
    expect(first!.hires[0]!.personName).toBe("Artur Juszczak");
    expect(first!.crew.map((member) => member.personName)).toEqual([
      "Artur Juszczak",
    ]);
    // The counts stay whole: „12 of the 20 changes we know about” is the claim
    // the card exists to make, and reporting 12 of 12 would misstate the
    // register.
    expect(first!.known).toBe(20);
    expect(first!.visible).toBe(12);
    expect(response.includesDrafts).toBe(false);
  });

  it("keeps a cluster nobody could open away from a logged out reader", async () => {
    mockEnsure.mockResolvedValue(
      doc([cluster({ id: "region:draft", visible: 2 })]),
    );

    expect((await call()).clusters).toEqual([]);
  });

  it("gives a signed in reader the drafts, unedited", async () => {
    mockGetOptionalUser.mockResolvedValue({ uid: "editor" });
    mockEnsure.mockResolvedValue(
      doc([cluster({ id: "region:draft", visible: 0 })]),
    );

    const response = await call();
    const [first] = response.clusters as StoryCluster[];

    expect(first!.hires).toHaveLength(2);
    expect(first!.crew).toHaveLength(2);
    expect(response.includesDrafts).toBe(true);
  });

  it("filters by kind and honours the limit", async () => {
    mockQuery.kind = "owner";
    mockQuery.limit = 1;
    mockEnsure.mockResolvedValue(
      doc([
        cluster({ id: "owner:a", kind: "owner" }),
        cluster({ id: "owner:b", kind: "owner" }),
        cluster({ id: "region:c" }),
      ]),
    );

    const clusters = (await call()).clusters as StoryCluster[];
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.kind).toBe("owner");
  });

  it("answers with an empty feed rather than an error when nothing is stored", async () => {
    mockEnsure.mockResolvedValue(null);

    expect(await call()).toEqual({
      clusters: [],
      computedAt: "",
      windowStart: "",
      windowEnd: "",
      hiresConsidered: 0,
      hiresVisible: 0,
      includesDrafts: false,
    });
  });
});

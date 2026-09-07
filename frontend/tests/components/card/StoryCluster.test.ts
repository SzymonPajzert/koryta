import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import StoryClusterCard from "../../../app/components/card/StoryCluster.vue";
import type { StoryCluster } from "../../../shared/clusters";

function cluster(overrides: Partial<StoryCluster> = {}): StoryCluster {
  return {
    id: "region:teryt0662",
    kind: "region",
    key: "teryt0662",
    teryt: "0662",
    nodeId: "teryt0662",
    title: "Chełm",
    known: 20,
    visible: 12,
    companies: 8,
    expected: 10,
    partyMix: { PiS: 10, PSL: 4 },
    dominantParty: "PiS",
    dominantCount: 10,
    labelled: 14,
    partyP: 0.0001,
    partyQ: 0.008,
    partyLift: 2.81,
    partyLiftLow: 1.98,
    burstP: 0.001,
    burstQ: 0.01,
    burstLift: 1.9,
    burstLiftLow: 1.32,
    swept: 4,
    sweepExpected: 3.3,
    sweepP: 1,
    sweepQ: 1,
    sweepLift: 0,
    sweepLiftLow: 0,
    rolloutPerMonth: 0.17,
    localCandidates: 10,
    localExpected: 5.9,
    localP: 0.1,
    localQ: 0.2,
    localLift: 1.7,
    localLiftLow: 1.02,
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
    ],
    sectors: [{ category: "sport", count: 4 }],
    hires: [
      {
        edgeId: "e1",
        personId: "p1",
        personName: "Artur Juszczak",
        parties: ["PiS"],
        companyId: "c1",
        companyName: "MIEJSKIE PRZEDSIĘBIORSTWO ROBÓT DROGOWYCH",
        role: "Rada Nadzorcza",
        start: "2026-07-15",
        visible: true,
        localCandidate: true,
      },
    ],
    firstStart: "2025-01-01",
    lastStart: "2026-07-15",
    score: 5.75,
    ...overrides,
  };
}

const mount = (value: StoryCluster) =>
  mountSuspended(StoryClusterCard, { props: { cluster: value } });

describe("CardStoryCluster", () => {
  it("leads with the party claim when that is what put the cluster on the list", async () => {
    const card = await mount(cluster());
    const text = card.text();
    expect(text).toContain("20 zmian w 8 spółkach");
    expect(text).toContain("10 z 14");
    expect(text).toContain("PiS");
    expect(text).toContain("trzy razy częściej");
    // The comparison is against companies with the same kind of owner, not
    // against the country flat - see `ClusterHire.ownerTier`.
    expect(text).toContain("z takim samym właścicielem");
  });

  it("leads with the rollout when there is no party to speak of", async () => {
    const card = await mount(
      cluster({
        kind: "owner",
        key: "skarb|POLSKIE RADIO",
        title: "POLSKIE RADIO",
        subtitle: "Skarb Państwa",
        nodeId: undefined,
        teryt: undefined,
        dominantParty: undefined,
        dominantCount: 0,
        labelled: 0,
        partyMix: {},
        partyQ: 1,
        partyLiftLow: 0,
        swept: 6,
        sweepExpected: 2.81,
        sweepQ: 0.042,
        sweepLiftLow: 1.24,
        rolloutPerMonth: 0.67,
        channels: ["sweep"],
        crew: [],
        localCandidates: 0,
      }),
    );
    const text = card.text();
    expect(text).toContain("właściciel: Skarb Państwa");
    expect(text).toContain("W 6 z tych spółek wymieniono kilka osób naraz");
    expect(text).toContain("spodziewaliśmy się 2,81");
    expect(text).toContain("grupa spółek");
  });

  it("links every hire to the person behind it", async () => {
    const card = await mount(cluster());
    const links = card
      .findAll("a")
      .map((anchor) => anchor.attributes("href") ?? "");
    expect(links).toContain("/osoba/artur-juszczak-p1");
  });

  it("says nothing about a crew or local candidates when there are none", async () => {
    const card = await mount(cluster({ crew: [], localCandidates: 0 }));
    expect(card.text()).not.toContain("W kilku spółkach naraz");
    expect(card.text()).not.toContain("kandydowa");
  });
});

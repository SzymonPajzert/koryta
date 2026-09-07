import type { ClusterFeed } from "../../../server/api/stats/clusters.get";
import type { StoryCluster } from "../../../shared/clusters";

/** A stand-in for `/api/stats/clusters`, for the visual capture of
 * /eksploruj/historie and of the home page section.
 *
 * WHY A FIXTURE AND NOT THE SEED. A cluster is a statistical claim about the
 * whole graph - a group is only on the list because it differs from the rest of
 * the country in the same window - so producing one from the seed would mean
 * seeding a country. `scripts/nodes.json` has four dozen nodes and no
 * two-year-deep employment history, so a capture against it draws the empty
 * alert and photographs the copy around a list that is not there.
 *
 * WHAT IT IS SHAPED FOR. The three kinds, because each draws a different chip
 * and a different footer; the three ledes, because they are built by different
 * branches; a title long enough to wrap („Powiat tomaszowski (Tomaszów
 * Mazowiecki)” is the longest region name in the graph); a cluster with a
 * subtitle and no party at all, which is what a rollout looks like; and one
 * with neither a crew nor a local candidate, so the card's two optional lines
 * are covered by their absence as well as their presence.
 *
 * The numbers are the real ones from the 2026-09-07 export, so the copy in the
 * baseline is the copy a reader would actually see.
 */

function base(overrides: Partial<StoryCluster>): StoryCluster {
  return {
    id: "region:teryt0662",
    kind: "region",
    key: "teryt0662",
    title: "Chełm",
    known: 20,
    visible: 12,
    companies: 8,
    expected: 10.5,
    partyMix: {},
    dominantCount: 0,
    labelled: 0,
    partyP: 1,
    partyQ: 1,
    partyLift: 0,
    partyLiftLow: 0,
    burstP: 1,
    burstQ: 1,
    burstLift: 0,
    burstLiftLow: 0,
    swept: 0,
    sweepExpected: 0,
    sweepP: 1,
    sweepQ: 1,
    sweepLift: 0,
    sweepLiftLow: 0,
    rolloutPerMonth: 0,
    localCandidates: 0,
    localExpected: 0,
    localP: 1,
    localQ: 1,
    localLift: 0,
    localLiftLow: 0,
    partyPUnpublished: 1,
    partyIsEditorialArtifact: false,
    channels: [],
    crew: [],
    sectors: [],
    hires: [],
    firstStart: "2024-10-01",
    lastStart: "2026-08-13",
    score: 1,
    ...overrides,
  };
}

function hire(
  personName: string,
  companyName: string,
  start: string,
  parties: string[] = [],
) {
  const id = personName.toLowerCase().replace(/\s+/g, "-");
  return {
    edgeId: `e-${id}`,
    personId: `p-${id}`,
    personName,
    parties,
    companyId: `c-${companyName.slice(0, 6).toLowerCase()}`,
    companyName,
    role: "Rada Nadzorcza",
    start,
    visible: true,
    localCandidate: parties.length > 0,
  };
}

export function storyClustersFixture(): ClusterFeed {
  return {
    clusters: [
      base({
        teryt: "0662",
        nodeId: "teryt0662",
        partyMix: { PiS: 10, PSL: 4 },
        dominantParty: "PiS",
        dominantCount: 10,
        labelled: 14,
        partyQ: 0.008,
        partyLift: 2.81,
        partyLiftLow: 1.98,
        channels: ["party", "burst"],
        partyPUnpublished: 0.004,
        burstQ: 0.01,
        burstLift: 1.9,
        burstLiftLow: 1.32,
        localCandidates: 10,
        localExpected: 5.93,
        crew: [
          {
            personId: "p-artur-juszczak",
            personName: "Artur Juszczak",
            companies: 3,
            parties: ["PSL", "PiS"],
          },
          {
            personId: "p-marcin-tymura",
            personName: "Marcin Tymura",
            companies: 2,
            parties: ["PiS"],
          },
        ],
        sectors: [
          { category: "sport", count: 4 },
          { category: "cieplownictwo", count: 2 },
        ],
        hires: [
          hire(
            "Artur Juszczak",
            "MIEJSKIE PRZEDSIĘBIORSTWO ROBÓT DROGOWYCH (Chełm)",
            "2026-07-15",
            ["PSL", "PiS"],
          ),
          hire(
            "Marcin Tymura",
            'CHEŁMSKI KLUB SPORTOWY "CHEŁMIANKA CHEŁM"',
            "2026-08-13",
            ["PiS"],
          ),
          hire(
            "Kamila Grzywaczewska",
            'CHEŁMSKI KLUB SPORTOWY "CHEŁMIANKA CHEŁM"',
            "2025-10-29",
            ["PiS"],
          ),
          hire("Rafał Bukowski", "SIM CHEŁM", "2025-11-27"),
        ],
        score: 5.75,
      }),
      base({
        id: "owner:skarb|POLSKIE RADIO",
        kind: "owner",
        key: "skarb|POLSKIE RADIO",
        title: "POLSKIE RADIO",
        subtitle: "Skarb Państwa",
        known: 18,
        visible: 3,
        companies: 9,
        swept: 6,
        sweepExpected: 2.81,
        sweepQ: 0.042,
        sweepLift: 2.14,
        sweepLiftLow: 1.24,
        rolloutPerMonth: 0.67,
        channels: ["sweep"],
        hires: [
          hire(
            "Antoni Dragan",
            "POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W KRAKOWIE",
            "2026-05-29",
            ["Nowa Lewica"],
          ),
          hire(
            "Dariusz Frejman",
            "POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W ZIELONEJ GÓRZE",
            "2026-05-13",
          ),
          hire(
            "Anna Drobek",
            "POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W KOSZALINIE",
            "2026-05-26",
          ),
        ],
        score: 6.2,
      }),
      base({
        id: "sector:sport",
        kind: "sector",
        key: "sport",
        title: "Sport i rekreacja",
        known: 75,
        visible: 12,
        companies: 41,
        partyMix: { PiS: 11, PO: 3, PSL: 1 },
        dominantParty: "PiS",
        dominantCount: 11,
        labelled: 15,
        partyQ: 0.001,
        partyLift: 2.08,
        partyLiftLow: 1.4,
        channels: ["party", "local"],
        partyPUnpublished: 0.01,
        localCandidates: 32,
        localExpected: 21.03,
        localQ: 0.034,
        sectors: [{ category: "sport", count: 75 }],
        hires: [
          hire(
            "Robert Gut",
            'PŁYWALNIA MIEJSKA "NAWA" (Skierniewice)',
            "2026-04-02",
            ["PiS"],
          ),
          hire(
            "Marcin Tymura",
            'CHEŁMSKI KLUB SPORTOWY "CHEŁMIANKA CHEŁM"',
            "2026-08-13",
            ["PiS"],
          ),
        ],
        score: 3.13,
      }),
      base({
        id: "region:teryt1016",
        key: "teryt1016",
        teryt: "1016",
        nodeId: "teryt1016",
        title: "Powiat tomaszowski (Tomaszów Mazowiecki)",
        known: 32,
        visible: 6,
        companies: 11,
        partyMix: { PiS: 6, PO: 1 },
        dominantParty: "PiS",
        dominantCount: 6,
        labelled: 7,
        partyQ: 0.02,
        partyLift: 2.58,
        partyLiftLow: 1.53,
        channels: ["party", "burst"],
        partyPUnpublished: 0.02,
        burstQ: 0.004,
        burstLift: 1.94,
        burstLiftLow: 1.46,
        localCandidates: 14,
        localExpected: 8.82,
        crew: [
          {
            personId: "p-mariusz-kotynia",
            personName: "Mariusz Kotynia",
            companies: 2,
            parties: ["PiS"],
          },
        ],
        hires: [
          hire(
            "Mariusz Kotynia",
            "ZAKŁAD GOSPODARKI WODNO-KANALIZACYJNEJ W TOMASZOWIE MAZOWIECKIM",
            "2026-02-11",
            ["PiS"],
          ),
        ],
        score: 3.8,
      }),
    ],
    computedAt: "2026-09-07T02:00:00.000Z",
    windowStart: "2024-09-08",
    windowEnd: "2026-09-07",
    hiresConsidered: 14660,
    hiresVisible: 2801,
    includesDrafts: false,
  };
}

import { describe, it, expect } from "vitest";
import {
  benjaminiHochberg,
  binomialTail,
  companyNameStem,
  clusterTableLink,
  computeStoryClusters,
  foldIdentities,
  fisherCombine,
  poissonBinomialTail,
  spanTail,
  sweepBucket,
  wilsonLowerBound,
  type ClusterHire,
} from "../../shared/clusters";

const TODAY = "2026-09-07";

/** Company names that differ by a word rather than by a number.
 *
 * `isNumberedFleet` throws away a group whose companies are „INVEST PV 7/40/58”
 * - an SPV fleet, not a story - so a fixture built from `NAZWA ${i}` is
 * silently dropped and the test it belongs to fails somewhere else entirely. */
const TOWNS = [
  "KATOWICE",
  "WROCŁAW",
  "GDAŃSK",
  "SZCZECIN",
  "ZIELONA GÓRA",
  "KOSZALIN",
  "KRAKÓW",
  "RZESZÓW",
  "KIELCE",
  "OLSZTYN",
];
const town = (i: number) => TOWNS[i % TOWNS.length]!;

function hire(
  overrides: Partial<ClusterHire> & { edgeId: string },
): ClusterHire {
  return {
    personId: overrides.edgeId,
    personName: `Osoba ${overrides.edgeId}`,
    parties: [],
    companyId: "c1",
    companyName: "SPÓŁKA JEDEN",
    categories: [],
    ownerIds: [],
    start: "2026-01-01",
    visible: true,
    localCandidate: false,
    ...overrides,
  };
}

/** A background of hires that carries the national rates: enough spread over
 * enough companies that no group of four is remarkable against it. */
function background(): ClusterHire[] {
  const rows: ClusterHire[] = [];
  for (let i = 0; i < 200; i++) {
    rows.push(
      hire({
        edgeId: `bg${i}`,
        companyId: `bgc${i % 50}`,
        companyName: `TŁO ${town(i)} ${Math.floor(i / 10)}`,
        regionId: `teryt99${i % 20}`,
        // Keyed on the half rather than on `i`, because half of these rows sit
        // outside the window and a party cycling on `i % 4` would put only two
        // of the four parties inside it.
        parties: [["PO", "PiS", "PSL", "SLD"][Math.floor(i / 2) % 4]!],
        // Half inside the window, half outside it, so the national in-window
        // share is a round number the assertions can reason about.
        /* Spread over the month rather than all on one day: two people
         * arriving at one company on one day is what the sweep channel counts,
         * and a background where every company is swept leaves it nothing to
         * measure against. */
        start:
          i % 2 === 0
            ? `2026-02-${String((i % 28) + 1).padStart(2, "0")}`
            : "2021-02-01",
      }),
    );
  }

  /* Sixty companies that took two people in the window on two different days.
   * Without them the only two-hire companies in the fixture are the swept ones,
   * so the national rate for that size comes out at 1.0 and the sweep channel
   * has nothing to measure against. */
  for (let i = 0; i < 60; i++) {
    for (const [n, day] of [
      [0, "2025-08-04"],
      [1, "2026-01-19"],
    ] as const) {
      rows.push(
        hire({
          edgeId: `quiet${i}-${n}`,
          personId: `quietp${i}-${n}`,
          companyId: `quietc${i}`,
          companyName: `SPOKOJNA ${town(i)} ${i}`,
          regionId: `teryt77${i % 15}`,
          start: day,
        }),
      );
    }
    rows.push(
      hire({
        edgeId: `quiet${i}-old`,
        personId: `quietp${i}-old`,
        companyId: `quietc${i}`,
        companyName: `SPOKOJNA ${town(i)} ${i}`,
        regionId: `teryt77${i % 15}`,
        start: "2020-05-05",
      }),
    );
  }
  return rows;
}

const labels = { titles: {}, teryts: {} };

/** Company-owned companies with an ordinary mix of parties.
 *
 * The stratified tests compare a group against others with the same kind of
 * owner, and a stratum made up entirely of one cluster compares that cluster
 * to itself. Real data does not have that problem - the `spolka` stratum holds
 * 904 hires and the biggest cluster in it is 142 - but a fixture does. */
function spolkaBackground(): ClusterHire[] {
  const rows: ClusterHire[] = [];
  for (let i = 0; i < 120; i++) {
    rows.push(
      hire({
        edgeId: `sp${i}`,
        personId: `spp${i}`,
        companyId: `spc${i % 30}`,
        companyName: `SPÓŁKA GRUPOWA ${town(i)} ${i % 30}`,
        ownerIds: [`spowner${i % 10}`],
        ownerTier: "spolka",
        parties: [["PO", "PiS", "PSL", "SLD"][Math.floor(i / 2) % 4]!],
        visible: false,
        start:
          i % 2 === 0
            ? `2026-01-${String((i % 28) + 1).padStart(2, "0")}`
            : "2021-01-05",
      }),
    );
  }
  return rows;
}

/** Spells at a cluster's companies from before the window.
 *
 * Without them the burst guard drops the group - a company whose whole recorded
 * history is inside the window tells you only that the crawler reached it
 * recently - and a fixture that forgot them fails somewhere else entirely. */
function history(companyIds: string[], prefix: string): ClusterHire[] {
  return companyIds.flatMap((companyId, index) =>
    [0, 1, 2].map((n) =>
      hire({
        edgeId: `${prefix}-hist-${index}-${n}`,
        personId: `${prefix}-histp-${index}-${n}`,
        companyId,
        companyName: `SPÓŁKA ${prefix.toUpperCase()} ${town(index)} ${index}`,
        start: `202${n}-03-0${index + 1}`,
      }),
    ),
  );
}

describe("binomialTail", () => {
  it("is 1 for k <= 0 and 0 beyond n", () => {
    expect(binomialTail(0, 10, 0.5)).toBe(1);
    expect(binomialTail(11, 10, 0.5)).toBe(0);
  });

  it("agrees with the closed form on a small case", () => {
    // P(X >= 2 | n = 3, p = 0.5) = 4/8
    expect(binomialTail(2, 3, 0.5)).toBeCloseTo(0.5, 10);
  });

  it("stays in range where a factorial would overflow", () => {
    const tail = binomialTail(1040, 3815, 0.218);
    expect(tail).toBeGreaterThan(0);
    expect(tail).toBeLessThan(1e-10);
  });
});

describe("wilsonLowerBound", () => {
  it("discounts a small sample harder than a large one at the same rate", () => {
    expect(wilsonLowerBound(2, 2)).toBeLessThan(wilsonLowerBound(20, 20));
  });

  it("never exceeds the observed proportion", () => {
    for (const [k, n] of [
      [1, 4],
      [6, 9],
      [11, 16],
      [1040, 3815],
    ] as const) {
      expect(wilsonLowerBound(k, n)).toBeLessThanOrEqual(k / n);
    }
  });
});

describe("benjaminiHochberg", () => {
  it("leaves the smallest p multiplied by the number of tests", () => {
    const q = benjaminiHochberg([0.01, 0.5, 0.9]);
    expect(q[0]).toBeCloseTo(0.03, 10);
  });

  it("is monotone in the ranking", () => {
    const q = benjaminiHochberg([0.04, 0.01, 0.2, 0.9]);
    expect(q[1]!).toBeLessThanOrEqual(q[0]!);
    expect(q[0]!).toBeLessThanOrEqual(q[2]!);
  });
});

describe("poissonBinomialTail", () => {
  it("reduces to the binomial when every trial is the same", () => {
    expect(poissonBinomialTail(2, [0.5, 0.5, 0.5])).toBeCloseTo(
      binomialTail(2, 3, 0.5),
      10,
    );
  });

  it("gives a company that cannot be swept no chance of being swept", () => {
    // Three of the nine Polskie Radio stations had one hire in the window, so
    // they cannot have had two people arrive together. The remaining six are
    // what the six observed sweeps have to come from.
    const probabilities = [0, 0, 0, 0.378, 0.378, 0.378, 0.603, 0.603, 0.603];
    expect(poissonBinomialTail(7, probabilities)).toBe(0);
    expect(poissonBinomialTail(6, probabilities)).toBeCloseTo(0.0118, 3);
  });
});

describe("spanTail", () => {
  it("is 1 for fewer than two points", () => {
    expect(spanTail(1, 10, 730)).toBe(1);
  });

  it("is small when many points fall in a short span", () => {
    expect(spanTail(6, 263, 730)).toBeLessThan(0.03);
    expect(spanTail(6, 700, 730)).toBeGreaterThan(0.5);
  });
});

describe("fisherCombine", () => {
  it("is stronger than either half", () => {
    const combined = fisherCombine(0.012, 0.026);
    expect(combined).toBeLessThan(0.012);
    expect(combined).toBeCloseTo(0.0027, 3);
  });
});

describe("sweepBucket", () => {
  it("keeps the small sizes apart and lumps the large ones", () => {
    expect([1, 2, 3, 4].map(sweepBucket)).toEqual([1, 2, 3, 4]);
    expect([5, 6].map(sweepBucket)).toEqual([5, 5]);
    expect([7, 10].map(sweepBucket)).toEqual([7, 7]);
    expect(sweepBucket(40)).toBe(11);
  });
});

describe("companyNameStem", () => {
  it("takes the first two words, without punctuation or a place suffix", () => {
    expect(
      companyNameStem("POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W KATOWICACH"),
    ).toBe("POLSKIE RADIO");
    expect(companyNameStem('"CHEŁMIANKA CHEŁM" (Chełm)')).toBe(
      "CHEŁMIANKA CHEŁM",
    );
  });
});

describe("computeStoryClusters", () => {
  it("returns nothing when no hire falls in the window", () => {
    const old = [hire({ edgeId: "a", start: "2019-01-01" })];
    expect(computeStoryClusters(old, TODAY, labels)).toEqual([]);
  });

  it("counts one appointment once, however often it was written down", () => {
    const rows = [
      ...background(),
      ...history(["dup", "dup2", "dup3"], "dup"),
      hire({
        edgeId: "d1",
        personId: "p1",
        companyId: "dup",
        regionId: "terytDUP",
        role: "Zarząd",
        parties: ["PiS"],
        start: "2026-03-01",
      }),
      hire({
        edgeId: "d2",
        personId: "p1",
        companyId: "dup",
        regionId: "terytDUP",
        role: "Prezes Zarządu",
        parties: ["PiS"],
        start: "2026-03-01",
      }),
      hire({
        edgeId: "d3",
        personId: "p2",
        companyId: "dup2",
        regionId: "terytDUP",
        parties: ["PiS"],
        start: "2026-03-02",
      }),
      hire({
        edgeId: "d4",
        personId: "p3",
        companyId: "dup2",
        regionId: "terytDUP",
        parties: ["PiS"],
        start: "2026-03-02",
      }),
      hire({
        edgeId: "d5",
        personId: "p4",
        companyId: "dup3",
        regionId: "terytDUP",
        parties: ["PiS"],
        start: "2026-03-03",
      }),
      hire({
        edgeId: "d6",
        personId: "p5",
        companyId: "dup3",
        regionId: "terytDUP",
        parties: ["PiS"],
        start: "2026-03-03",
      }),
    ];
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytDUP",
    );
    // Six rows, five appointments: the same person at the same company on the
    // same day under two spellings of the role is one of them.
    expect(cluster?.known).toBe(5);
  });

  it("finds a one-party region and reports the lift against the country", () => {
    const rows = [
      ...background(),
      ...history(["chc0", "chc1", "chc2", "chc3"], "ch"),
    ];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `ch${i}`,
          personId: `chp${i}`,
          companyId: `chc${i % 4}`,
          companyName: `CHEŁM ${town(i)}`,
          regionId: "teryt0662",
          parties: ["PiS"],
          localCandidate: i < 5,
          start: `2026-0${(i % 8) + 1}-01`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, {
      titles: { teryt0662: "Chełm" },
      teryts: { teryt0662: "0662" },
    });
    const chelm = clusters.find((c) => c.id === "region:teryt0662");
    expect(chelm).toBeDefined();
    expect(chelm!.title).toBe("Chełm");
    expect(chelm!.teryt).toBe("0662");
    expect(chelm!.dominantParty).toBe("PiS");
    /* PiS is a quarter of the background, and these eight hires are themselves
     * part of the country they are compared against - 33 of 108 labelled hires
     * are PiS once they are counted - so eight of eight is a lift of 3.3 rather
     * than of 4. Self-inclusion shrinks the effect, which is the safe
     * direction, and on the real graph a twenty-hire cluster moves a four
     * thousand hire baseline by half a percent. */
    expect(chelm!.partyLift).toBeCloseTo(3.3, 1);
    expect(chelm!.partyLiftLow).toBeGreaterThan(1.2);
    expect(chelm!.partyQ).toBeLessThan(0.05);
    expect(chelm!.localCandidates).toBe(5);
  });

  it("does not rank a large group by its size alone", () => {
    /* Two hundred hires at one party's slight advantage: unmistakable to a
     * p-value and not a story. The gate is the lift, so it stays off. */
    const rows = [...background()];
    for (let i = 0; i < 200; i++) {
      rows.push(
        hire({
          edgeId: `big${i}`,
          personId: `bigp${i}`,
          companyId: `bigc${i % 40}`,
          regionId: "terytBIG",
          parties: [i % 3 === 0 ? "PO" : ["PiS", "PSL", "SLD"][i % 3]!],
          start: "2026-04-01",
        }),
      );
    }
    const big = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytBIG",
    );
    expect(big?.partyLiftLow ?? 0).toBeLessThan(1.2);
  });

  it("finds a rollout across a group with no party labels at all", () => {
    /* Polskie Radio's shape: nine sibling companies under one owner, six of
     * them with two people arriving on one day, all inside nine months, and
     * nobody carrying a party. Nothing but the sweep channel can see it. */
    const rows = [
      ...background(),
      ...history(
        Array.from({ length: 9 }, (_, i) => `radioc${i}`),
        "radio",
      ),
    ];
    for (let station = 0; station < 6; station++) {
      const day = `2025-${String(station + 4).padStart(2, "0")}-10`;
      for (const seat of ["a", "b"]) {
        rows.push(
          hire({
            edgeId: `radio${station}${seat}`,
            personId: `radiop${station}${seat}`,
            companyId: `radioc${station}`,
            companyName: `POLSKIE RADIO ${town(station)}`,
            regionId: `terytR${station}`,
            ownerIds: ["skarb"],
            start: day,
          }),
        );
      }
    }
    for (let station = 6; station < 9; station++) {
      rows.push(
        hire({
          edgeId: `radio${station}`,
          personId: `radiop${station}`,
          companyId: `radioc${station}`,
          companyName: `POLSKIE RADIO ${town(station)}`,
          regionId: `terytR${station}`,
          ownerIds: ["skarb"],
          start: "2025-06-10",
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, {
      titles: { skarb: "Skarb Państwa" },
    });
    const rollout = clusters.find((c) => c.kind === "owner");
    expect(rollout).toBeDefined();
    expect(rollout!.swept).toBe(6);
    expect(rollout!.sweepQ).toBeLessThan(0.05);
    expect(rollout!.dominantParty).toBeUndefined();
  });

  it("names an owner group after the brand when the owner is a bucket", () => {
    /* An owner the caller marked as an administration rather than a company,
     * so its clusters are split by company-name stem: „POLSKIE RADIO”, owned
     * by Skarb Państwa. */
    const rows = [
      ...background(),
      ...history(
        Array.from({ length: 40 }, (_, i) => `statec${i}`),
        "state",
      ),
    ];
    for (let i = 0; i < 40; i++) {
      rows.push(
        hire({
          edgeId: `state${i}`,
          personId: `statep${i}`,
          companyId: `statec${i}`,
          companyName:
            i < 8 ? `POLSKIE RADIO ${town(i)}` : `INNA SPÓŁKA ${town(i)} X`,
          regionId: `terytS${i}`,
          ownerIds: ["skarb"],
          parties: i < 8 ? ["SLD"] : [],
          start: `2026-05-0${(i % 8) + 1}`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, {
      titles: { skarb: "Skarb Państwa" },
      bucketOwners: ["skarb"],
    });
    const radio = clusters.find((c) => c.title === "POLSKIE RADIO");
    expect(radio).toBeDefined();
    expect(radio!.subtitle).toBe("Skarb Państwa");
    expect(radio!.companies).toBe(8);
  });

  it("keeps a holding whole, however many companies it owns", () => {
    /* Only an owner the caller marks as a bucket is split by name stem. Size
     * cannot decide it: ORLEN owns 48 companies and PKP 28, and splitting them
     * turned the PKP group into „PKP CARGO” and „PKP INTERCITY” - the opposite
     * of what the owner key is for. */
    const rows = [
      ...background(),
      ...spolkaBackground(),
      ...history(
        Array.from({ length: 30 }, (_, i) => `holdc${i}`),
        "hold",
      ),
    ];
    for (let i = 0; i < 30; i++) {
      rows.push(
        hire({
          edgeId: `hold${i}`,
          personId: `holdp${i}`,
          companyId: `holdc${i}`,
          companyName:
            i < 10 ? `PKP CARGO ${town(i)}` : `PKP INTERCITY ${town(i)}`,
          regionId: `terytH${i}`,
          ownerIds: ["pkp"],
          ownerTier: "spolka",
          parties: ["PiS"],
          start: `2026-05-0${(i % 8) + 1}`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, {
      titles: { pkp: "POLSKIE KOLEJE PAŃSTWOWE" },
    });
    expect(
      clusters.find((c) => c.title === "POLSKIE KOLEJE PAŃSTWOWE"),
    ).toBeDefined();
    expect(clusters.filter((c) => c.subtitle)).toEqual([]);
  });

  it("does not let a subsidiary erase the group it belongs to", () => {
    /* PKP Cargo's thirteen appointments are thirteen of the parent group's
     * thirty-seven, so the slice scored higher and the group - which is what
     * the story is about - vanished from the list. */
    const rows = [
      ...background(),
      ...history(["subc0", "subc1", "subc2", "subc3"], "sub"),
    ];
    for (let i = 0; i < 12; i++) {
      const inCargo = i < 5;
      rows.push(
        hire({
          edgeId: `sub${i}`,
          personId: `subp${i}`,
          companyId: `subc${i % 4}`,
          companyName: `SPÓŁKA GRUPY ${town(i)}`,
          regionId: `terytSUB${i}`,
          ownerIds: inCargo ? ["cargo", "parent"] : ["parent"],
          ownerTier: "spolka",
          parties: ["PiS"],
          start: `2026-04-0${(i % 8) + 1}`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, {
      titles: { parent: "GRUPA", cargo: "CÓRKA" },
    });
    expect(clusters.map((c) => c.title)).toContain("GRUPA");
    expect(clusters.map((c) => c.title)).not.toContain("CÓRKA");
  });

  it("finds a group being staffed with politicians of no particular party", () => {
    /* The PKP shape: 249 appointments across a state holding in three years,
     * breaking down PSL 22 / KO 18 / PiS 17 / Lewica 16 with 173 carrying no
     * signal at all. No party dominates, so the purity test says nothing -
     * while a quarter of the arrivals being political people is the story. */
    const rows = [
      ...background(),
      ...history(
        Array.from({ length: 12 }, (_, i) => `denc${i}`),
        "den",
      ),
    ];
    /* A stratum of company-owned companies where politics is rare, so the
     * group has something to stand out against. */
    for (let i = 0; i < 300; i++) {
      rows.push(
        hire({
          edgeId: `plain${i}`,
          personId: `plainp${i}`,
          companyId: `plainc${i % 60}`,
          companyName: `ZWYKŁA ${town(i)} ${i % 60}`,
          ownerIds: [`plainowner${i % 20}`],
          ownerTier: "spolka",
          parties: i % 10 === 0 ? ["PO"] : [],
          visible: false,
          start: `2026-0${(i % 6) + 1}-1${i % 9}`,
        }),
      );
    }
    for (let i = 0; i < 40; i++) {
      rows.push(
        hire({
          edgeId: `den${i}`,
          personId: `denp${i}`,
          companyId: `denc${i % 12}`,
          companyName: `GRUPOWA ${town(i)} ${i % 12}`,
          ownerIds: ["holding"],
          ownerTier: "spolka",
          // Four parties, none of them dominant, and a third of the arrivals.
          parties:
            i % 3 === 0 ? [["PO", "PiS", "PSL", "Nowa Lewica"][i % 4]!] : [],
          visible: false,
          start: `2026-0${(i % 6) + 1}-2${i % 8}`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, {
      titles: { holding: "GRUPA KOLEJOWA" },
    }).find((c) => c.title === "GRUPA KOLEJOWA");
    expect(cluster).toBeDefined();
    expect(cluster!.channels).toContain("density");
    // Not the party channel: no party holds enough of it.
    expect(cluster!.channels).not.toContain("party");
    expect(cluster!.densityLift).toBeGreaterThan(1.2);
  });

  it("drops the weaker of two clusters built from the same hires", () => {
    /* A gmina owns the companies seated in it, so the region and the owner are
     * the same story told twice. */
    const rows = [
      ...background(),
      ...history(["bothc0", "bothc1", "bothc2", "bothc3"], "both"),
    ];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `both${i}`,
          personId: `bothp${i}`,
          companyId: `bothc${i % 4}`,
          regionId: "terytBOTH",
          ownerIds: ["gminaBOTH"],
          parties: ["PiS"],
          start: `2026-06-0${(i % 4) + 1}`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, labels);
    const matching = clusters.filter(
      (c) => c.id === "region:terytBOTH" || c.id === "owner:gminaBOTH",
    );
    expect(matching).toHaveLength(1);
  });

  it("counts one human once, however many pages the graph has for them", () => {
    /* „Robert Gut” and „Robert Paweł Gut” are one man, and the cluster they
     * carried between them - Gmina Skierniewice, six visible hires across five
     * companies - was on the public list until this folded them. */
    const rows = [
      ...background(),
      ...history(["gutc0", "gutc1", "gutc2"], "gut"),
    ];
    for (const [n, day] of [
      ["Robert Gut", "2026-04-01"],
      ["Robert Paweł Gut", "2026-04-01"],
      ["Robert Gut", "2026-05-02"],
      ["Robert Paweł Gut", "2026-05-02"],
    ].entries()) {
      rows.push(
        hire({
          edgeId: `gut${n}`,
          personId: `gutp${n}`,
          personName: day[0]!,
          companyId: `gutc${n % 3}`,
          regionId: "terytGUT",
          parties: ["PiS"],
          start: day[1]!,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytGUT",
    );
    // Four rows, two appointments, one person - so no crew and no cluster.
    expect(cluster).toBeUndefined();
  });

  it("counts a Trzecia Droga hire once, not once per coalition partner", () => {
    /* `parties_of_committee` maps the joint list to both PSL and Polska 2050
     * and unions both onto the person, so 72 of the 73 „Polska 2050” hires in
     * the window are PSL candidates counted twice. */
    const rows = [...background(), ...history(["td0", "td1", "td2"], "td")];
    for (let i = 0; i < 6; i++) {
      rows.push(
        hire({
          edgeId: `td${i}`,
          personId: `tdp${i}`,
          companyId: `td${i % 3}`,
          regionId: "terytTD",
          parties: ["PSL", "Polska 2050"],
          start: `2026-04-0${(i % 4) + 1}`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels, { maxQ: 1 }).find(
      (c) => c.id === "region:terytTD",
    );
    expect(cluster?.partyMix).toEqual({ PSL: 6 });
    expect(cluster?.labelled).toBe(6);
  });

  it("does not read one appointment as a town's whole party mix", () => {
    /* Nine of podkarpackie's 25 PiS seats start on one day at one hospital.
     * A binomial treats them as independent draws and reports a certainty that
     * came from one decision by one person. */
    const rows = [...background(), ...history(["actc0", "actc1"], "act")];
    for (let i = 0; i < 9; i++) {
      rows.push(
        hire({
          edgeId: `act${i}`,
          personId: `actp${i}`,
          companyId: `actc${i % 2}`,
          regionId: "terytACT",
          parties: ["PiS"],
          start: "2026-05-26",
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytACT",
    );
    expect(cluster?.channels ?? []).not.toContain("party");
  });

  it("will not call a company the crawler only just found a burst", () => {
    /* Every spell at a company first entered this year is inside the window, so
     * the indirect standardisation predicts a fifth of what it has and reports
     * a fourfold burst for nothing. */
    const rows = [...background()];
    for (let i = 0; i < 12; i++) {
      rows.push(
        hire({
          edgeId: `new${i}`,
          personId: `newp${i}`,
          companyId: `newc${i % 3}`,
          companyName: `NOWA ${town(i)} ${i % 3}`,
          regionId: "terytNEW",
          start: `2026-0${(i % 6) + 1}-11`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytNEW",
    );
    expect(cluster?.channels ?? []).not.toContain("burst");
  });

  it("flags a party cluster that only exists among the published", () => {
    /* `parties[]` covers 92% of published people and 14% of unpublished ones,
     * so a town an editor has worked through reads as a party cluster. */
    const rows = [...background(), ...history(["edc0", "edc1", "edc2"], "ed")];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `ed${i}`,
          personId: `edp${i}`,
          companyId: `edc${i % 3}`,
          regionId: "terytED",
          // Only the published half carries a party at all.
          parties: i < 5 ? ["PiS"] : [],
          visible: i < 5,
          start: `2026-04-0${(i % 4) + 1}`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytED",
    );
    expect(cluster?.channels).toContain("party");
    expect(cluster?.partyIsEditorialArtifact).toBe(true);
  });

  it("throws away a fleet of numbered special-purpose vehicles", () => {
    /* „INVEST PV 7/40/58/59”: one holding, one project per company, the same
     * two or three people on every board. Every statistic here reads it as a
     * coordinated sweep, and it is corporate housekeeping. */
    const rows = [...background()];
    for (const suffix of ["7", "40", "58", "59"]) {
      for (const person of ["a", "b"]) {
        rows.push(
          hire({
            edgeId: `spv${suffix}${person}`,
            personId: `spvp${person}`,
            companyId: `spvc${suffix}`,
            companyName: `INVEST PV ${suffix}`,
            regionId: "terytSPV",
            ownerIds: ["holding"],
            start: "2026-05-01",
          }),
        );
      }
    }
    const clusters = computeStoryClusters(rows, TODAY, labels);
    expect(clusters.filter((c) => c.title.includes("INVEST"))).toEqual([]);
    expect(clusters.find((c) => c.id === "region:terytSPV")).toBeUndefined();
  });

  it("keeps a group whose companies differ by a town rather than a number", () => {
    const rows = [
      ...background(),
      ...history(["stemc0", "stemc1", "stemc2", "stemc3"], "stem"),
    ];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `stem${i}`,
          personId: `stemp${i}`,
          companyId: `stemc${i % 4}`,
          companyName: `POLSKIE RADIO ${town(i)}`,
          regionId: "terytSTEM",
          parties: ["PiS"],
          start: `2026-05-0${(i % 4) + 1}`,
        }),
      );
    }
    const clusters = computeStoryClusters(rows, TODAY, labels);
    expect(clusters.find((c) => c.id === "region:terytSTEM")).toBeDefined();
  });

  it("compares a group against companies with the same kind of owner", () => {
    /* „A gmina's companies hire the party that runs the gmina” is true and is
     * not a story. Where every gmina-owned hire in the country is PiS, a
     * gmina-owned cluster that is entirely PiS has to come out unremarkable. */
    const rows: ClusterHire[] = [];
    for (let i = 0; i < 120; i++) {
      rows.push(
        hire({
          edgeId: `tier${i}`,
          personId: `tierp${i}`,
          companyId: `tierc${i % 30}`,
          companyName: `SPÓŁKA ${town(i)} ${Math.floor(i / 10)}`,
          regionId: `teryt88${i % 10}`,
          ownerTier: i < 60 ? "gmina" : "panstwo",
          parties: [i < 60 ? "PiS" : "PO"],
          /* Spread over the month rather than all on one day: two people
           * arriving at one company on one day is what the sweep channel counts,
           * and a background where every company is swept leaves it nothing to
           * measure against. */
          start:
            i % 2 === 0
              ? `2026-02-${String((i % 28) + 1).padStart(2, "0")}`
              : "2021-02-01",
        }),
      );
    }
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `same${i}`,
          personId: `samep${i}`,
          companyId: `samec${i % 4}`,
          companyName: `GMINNA ${town(i)}`,
          regionId: "terytSAME",
          ownerTier: "gmina",
          parties: ["PiS"],
          start: "2026-03-01",
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytSAME",
    );
    // Unremarkable against gminas, however extreme it looks against the country.
    expect(cluster?.partyLiftLow ?? 0).toBeLessThan(1.2);
  });

  it("puts the hires a reader can open first", () => {
    const rows = [
      ...background(),
      ...history(["visc0", "visc1", "visc2", "visc3"], "vis"),
    ];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `vis${i}`,
          personId: `visp${i}`,
          companyId: `visc${i % 4}`,
          regionId: "terytVIS",
          parties: ["PiS"],
          visible: i % 2 === 1,
          start: `2026-06-0${(i % 4) + 1}`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytVIS",
    );
    const visibility = cluster!.hires.map((h) => h.visible);
    expect(visibility.slice(0, 4).every(Boolean)).toBe(true);
    expect(visibility.slice(4).some(Boolean)).toBe(false);
  });

  it("holds no nested arrays, which Firestore would refuse", () => {
    const rows = [
      ...background(),
      ...history(["fsc0", "fsc1", "fsc2", "fsc3"], "fs"),
    ];
    for (let i = 0; i < 8; i++) {
      rows.push(
        hire({
          edgeId: `fs${i}`,
          personId: `fsp${i}`,
          companyId: `fsc${i % 4}`,
          regionId: "terytFS",
          categories: ["szpitale"],
          parties: ["PiS"],
          start: `2026-06-0${(i % 4) + 1}`,
        }),
      );
    }
    const cluster = computeStoryClusters(rows, TODAY, labels).find(
      (c) => c.id === "region:terytFS",
    );
    expect(cluster!.sectors).toEqual([{ category: "szpitale", count: 8 }]);
    const nested = (value: unknown): boolean =>
      Array.isArray(value)
        ? value.some((item) => Array.isArray(item) || nested(item))
        : typeof value === "object" && value !== null
          ? Object.values(value).some(nested)
          : false;
    expect(nested(cluster)).toBe(false);
    expect(JSON.stringify(cluster)).not.toContain("undefined");
  });
});

describe("foldIdentities", () => {
  const person = (id: string, name: string, birthDate?: string) =>
    hire({ edgeId: id, personId: id, personName: name, birthDate });

  it("folds a middle name away", () => {
    const { person: folded } = foldIdentities([
      person("a", "Robert Gut"),
      person("b", "Robert Paweł Gut"),
    ]);
    expect(folded.get("b")).toBe(folded.get("a"));
  });

  it("refuses to fold two namesakes with different birth dates", () => {
    const { person: folded } = foldIdentities([
      person("a", "Jan Kowalski", "1970-01-01"),
      person("b", "Jan Adam Kowalski", "1985-06-12"),
    ]);
    expect(folded.get("b")).not.toBe(folded.get("a"));
  });

  it("refuses to fold a different surname, or a different first name", () => {
    const { person: folded } = foldIdentities([
      person("a", "Jan Kowalski"),
      person("b", "Jan Kowalczyk"),
      person("c", "Adam Kowalski"),
    ]);
    expect(folded.get("b")).not.toBe(folded.get("a"));
    expect(folded.get("c")).not.toBe(folded.get("a"));
  });

  it("folds two company pages carrying one KRS number", () => {
    const { company } = foldIdentities([
      hire({
        edgeId: "a",
        companyId: "c1",
        companyName: "MWiK",
        companyKrs: "1",
      }),
      hire({
        edgeId: "b",
        companyId: "c2",
        companyName: "MIEJSKIE WODOCIĄGI I KANALIZACJA",
        companyKrs: "1",
      }),
    ]);
    expect(company.get("c2")).toBe(company.get("c1"));
  });

  it("does not fold two companies that merely share a base name", () => {
    /* „MWiK” in Kołobrzeg and „MWiK” in Ostrowiec are different companies;
     * folding on the base name alone made 374 wrong merges. */
    const { company } = foldIdentities([
      hire({ edgeId: "a", companyId: "c1", companyName: "MWiK (Kołobrzeg)" }),
      hire({ edgeId: "b", companyId: "c2", companyName: "MWiK (Ostrowiec)" }),
    ]);
    expect(company.get("c2")).not.toBe(company.get("c1"));
  });
});

describe("clusterTableLink", () => {
  it("filters a region cluster on where the companies are registered", () => {
    const link = clusterTableLink({
      kind: "region",
      key: "teryt0662",
      teryt: "0662",
    });
    expect(link).toContain("companyTeryt=0662");
    // Without this the table answers who has ever held one of these seats.
    expect(link).toContain("currentlyEmployed=selected");
    // `teryt` is the person's own region and would be a different question.
    expect(link).not.toMatch(/[?&]teryt=/);
  });

  it("filters a sector cluster on the category", () => {
    expect(clusterTableLink({ kind: "sector", key: "sport" })).toContain(
      "category=sport",
    );
  });

  it("has nowhere to send an owner cluster, and says so", () => {
    expect(
      clusterTableLink({ kind: "owner", key: "skarb|POLSKIE RADIO" }),
    ).toBe("");
  });
});

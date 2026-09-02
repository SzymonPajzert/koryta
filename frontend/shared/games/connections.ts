/** Daily "Połączenia" (Connections) puzzle: 16 people in 4 hidden groups of 4.
 *
 * Generation is deterministic for a given date, so every player gets the same
 * board without persisting puzzles anywhere. This module is pure — Firestore
 * access lives in server/api/games/connections.get.ts.
 */

export const connectionsGroupKinds = [
  "party",
  "year",
  "region",
  "company",
] as const;

export type ConnectionsGroupKind = (typeof connectionsGroupKinds)[number];

export interface ConnectionsCandidate {
  id: string;
  name: string;
  /** Party affiliations, see `Person.parties`. */
  parties: string[];
  /** Ids of places the person was employed at (approved edges only). */
  companies: string[];
  /** Ids of regions the person ran in elections in. */
  regions: string[];
  /** Years of elections the person ran in. */
  years: string[];
}

export interface ConnectionsGroup {
  kind: ConnectionsGroupKind;
  /** Pool key: party name, election year, region node id or place node id. */
  key: string;
  label: string;
  personIds: string[];
}

export interface ConnectionsTile {
  id: string;
  name: string;
}

export interface ConnectionsPuzzle {
  date: string;
  number: number;
  /** The 16 tiles in board order (already shuffled). */
  people: ConnectionsTile[];
  groups: ConnectionsGroup[];
}

export const connectionsMaxMistakes = 4;

/** Date of puzzle #1. */
export const connectionsFirstDay = "2026-07-27";

export function connectionsPuzzleNumber(date: string): number {
  const days =
    (Date.parse(date) - Date.parse(connectionsFirstDay)) / (24 * 3600 * 1000);
  return Math.round(days) + 1;
}

export const connectionsGroupStyles: Record<
  ConnectionsGroupKind,
  { title: string; emoji: string; color: string }
> = {
  party: { title: "Partia", emoji: "🟨", color: "#f9df6d" },
  year: { title: "Rok wyborów", emoji: "🟩", color: "#a0c35a" },
  region: { title: "Region", emoji: "🟦", color: "#b0c4ef" },
  company: { title: "Miejsce pracy", emoji: "🟪", color: "#ba81c5" },
};

export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function candidateKeys(
  candidate: ConnectionsCandidate,
  kind: ConnectionsGroupKind,
): string[] {
  switch (kind) {
    case "party":
      return candidate.parties;
    case "year":
      return candidate.years;
    case "region":
      return candidate.regions;
    case "company":
      return candidate.companies;
  }
}

export interface ConnectionsLabelers {
  /** Place id → display name; undefined skips the pool. */
  company: (id: string) => string | undefined;
  /** Region id → display name; undefined skips the pool. */
  region: (id: string) => string | undefined;
}

function groupLabel(
  kind: ConnectionsGroupKind,
  key: string,
  labelers: ConnectionsLabelers,
): string | undefined {
  switch (kind) {
    case "party":
      return `Powiązani z: ${key}`;
    case "year":
      return `Startowali w wyborach ${key} r.`;
    case "region": {
      const name = labelers.region(key);
      return name && `Kandydowali w: ${name}`;
    }
    case "company": {
      const name = labelers.company(key);
      return name && `Pracowali w: ${name}`;
    }
  }
}

/** Pools are filled starting from the kinds with the fewest members per key,
 * so the scarce groups get first pick of people. */
const fillOrder: ConnectionsGroupKind[] = [
  "company",
  "region",
  "year",
  "party",
];

const groupSize = 4;

/** Builds `key → sorted candidate ids` pools for one kind, keeping only keys
 * with enough members to form a group. Sorting makes generation independent
 * of the candidate array order. */
function buildPools(
  candidates: ConnectionsCandidate[],
  kind: ConnectionsGroupKind,
): Map<string, string[]> {
  const pools = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const key of new Set(candidateKeys(candidate, kind))) {
      if (!pools.has(key)) pools.set(key, new Set());
      pools.get(key)!.add(candidate.id);
    }
  }
  const result = new Map<string, string[]>();
  for (const key of [...pools.keys()].sort()) {
    const members = pools.get(key)!;
    if (members.size >= groupSize) result.set(key, [...members].sort());
  }
  return result;
}

export function generateConnectionsPuzzle(
  date: string,
  candidates: ConnectionsCandidate[],
  labelers: ConnectionsLabelers,
  maxAttempts = 400,
): ConnectionsPuzzle | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const pools = new Map(
    connectionsGroupKinds.map((kind) => [kind, buildPools(candidates, kind)]),
  );
  const poolKeys = new Map(
    connectionsGroupKinds.map((kind) => [kind, [...pools.get(kind)!.keys()]]),
  );
  if (connectionsGroupKinds.some((kind) => poolKeys.get(kind)!.length === 0)) {
    return null;
  }

  const rand = mulberry32(hashSeed(`polaczenia:${date}`));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const keys = {} as Record<ConnectionsGroupKind, string>;
    for (const kind of connectionsGroupKinds) {
      const options = poolKeys.get(kind)!;
      keys[kind] = options[Math.floor(rand() * options.length)]!;
    }

    const labels = {} as Record<ConnectionsGroupKind, string>;
    for (const kind of connectionsGroupKinds) {
      const label = groupLabel(kind, keys[kind], labelers);
      if (!label) break;
      labels[kind] = label;
    }
    if (Object.keys(labels).length < connectionsGroupKinds.length) continue;

    // A person may only fit the key of their own group — otherwise the board
    // has two valid solutions and the guess feedback becomes unfair.
    const used = new Set<string>();
    const chosen = new Map<ConnectionsGroupKind, string[]>();
    for (const kind of fillOrder) {
      const otherKinds = connectionsGroupKinds.filter((k) => k !== kind);
      const eligible = pools
        .get(kind)!
        .get(keys[kind])!
        .filter(
          (id) =>
            !used.has(id) &&
            otherKinds.every(
              (other) =>
                !candidateKeys(byId.get(id)!, other).includes(keys[other]),
            ),
        );
      if (eligible.length < groupSize) break;
      const members = seededShuffle(eligible, rand).slice(0, groupSize);
      members.forEach((id) => used.add(id));
      chosen.set(kind, members);
    }
    if (chosen.size < connectionsGroupKinds.length) continue;

    const groups: ConnectionsGroup[] = connectionsGroupKinds.map((kind) => ({
      kind,
      key: keys[kind],
      label: labels[kind],
      personIds: chosen.get(kind)!,
    }));
    const people = seededShuffle(
      groups.flatMap((group) => group.personIds),
      rand,
    ).map((id) => ({ id, name: byId.get(id)!.name }));

    return { date, number: connectionsPuzzleNumber(date), people, groups };
  }

  return null;
}

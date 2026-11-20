import type { Person, Region } from "~~/shared/model";
import { canonicalParty, paintedParty } from "~~/shared/misc";

/**
 * The map on the home page needs one number per powiat. Reading it off the
 * region nodes meant fetchNodes("region") - all 810 documents - on every cache
 * miss, which over two days of logs was 21 full scans for a payload of four
 * fields per region. So the same rows live in one document, written whenever
 * the node stats they come from are recomputed, and the endpoint reads that.
 *
 * The counts are exactly as fresh as they were before: `stats.people` on a
 * region node is itself only written by /api/stats/computeNodes, so this
 * document goes stale at the same moment its source would have.
 */
export const REGION_STATS_DOC = "region_people";

export interface RegionStat {
  id: string;
  teryt?: string;
  name?: string;
  people: number;
  /** A powiat's people by the party each is drawn in (`paintedParty`, SLD
   * under Nowa Lewica). Those with no party are `people` minus the sum.
   * Powiaty only: the map draws nothing else, and the rows travel to every
   * home page visit. */
  parties?: Record<string, number>;
}

interface RegionStatsDoc {
  type: "region_people";
  regions: RegionStat[];
  computedAt: string;
}

export function regionStat(
  id: string,
  region: Partial<Region>,
  parties?: Record<string, number>,
): RegionStat {
  // Built field by field rather than as a literal: not every region node
  // carries a teryt or a name, and Firestore rejects a document with an
  // undefined value in it rather than dropping the field. Serving the row
  // straight out of a handler hid that - JSON drops undefined on its own.
  const stat: RegionStat = { id, people: region.stats?.people || 0 };
  if (region.teryt) stat.teryt = region.teryt;
  if (region.name) stat.name = region.name;
  if (parties) stat.parties = parties;
  return stat;
}

/** A powiat, as the home map draws it: four digits of teryt. */
export function isPowiat(region: Partial<Region>): boolean {
  return region.teryt?.length === 4;
}

/** How many of these people are drawn in each party. */
export function partyCounts(
  personIds: Iterable<string>,
  people: Record<string, Pick<Person, "parties"> | undefined>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of personIds) {
    const party = paintedParty(people[id]?.parties);
    if (!party) continue;
    const key = canonicalParty(party);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The rows, or null when nothing has computed them yet. */
export async function readRegionStats(
  db: FirebaseFirestore.Firestore,
): Promise<RegionStat[] | null> {
  const snap = await db.collection("stats").doc(REGION_STATS_DOC).get();
  if (!snap.exists) return null;
  const regions = (snap.data() as RegionStatsDoc | undefined)?.regions;
  return Array.isArray(regions) ? regions : null;
}

export async function writeRegionStats(
  db: FirebaseFirestore.Firestore,
  regions: RegionStat[],
  now: Date,
): Promise<void> {
  const doc: RegionStatsDoc = {
    type: "region_people",
    regions,
    computedAt: now.toISOString(),
  };
  await db.collection("stats").doc(REGION_STATS_DOC).set(doc);
}

import { asArray, pageIsPublic } from "~~/shared/model";
import type { Company, Edge, Person, Region } from "~~/shared/model";
import { categoryTitle } from "~~/shared/companyCategories";
import { namesASupervisorySeat } from "~~/shared/companyBodies";
import {
  computeStoryClusters,
  type ClusterHire,
  type ClusterLabels,
  type OwnerTier,
  type StoryCluster,
} from "~~/shared/clusters";
import { fetchNodes } from "~~/server/utils/fetch";

/** Where the story clusters live, and how they get there.
 *
 * The arithmetic is in `shared/clusters.ts`; this is everything around it -
 * turning the graph into the flat hires it wants, storing the answer, and
 * deciding when to work it out again.
 *
 * ## Why this is stored rather than computed per request
 *
 * A cluster is a statement about the whole graph: the party mix a town is
 * compared against is the national one, and the volume it is compared against
 * is every employment spell the register has. That is 19,178 employment edges,
 * 8,332 seat and ownership edges and 14,851 candidacies - a read of most of the
 * collection, which is not something a home page should do behind a reader.
 * Once a day it costs about a cent.
 *
 * ## Why nothing schedules it
 *
 * Because nothing in this repository schedules anything. The two precomputes
 * that exist - /api/stats/compute and /api/stats/computeNodes - are POST
 * endpoints, and the only caller of either is `data/pipelines/src/uploader.py`,
 * whose auth is a browser OAuth flow somebody has to click through;
 * `test_invariants.py` records the consequence in prose ("it is only refreshed
 * when someone runs /api/stats/computeNodes, which nothing in the repository
 * calls"). A feature that assumed a nightly job would simply never update.
 *
 * So this follows `ensureDailyRollups` in `activityRollup.ts` instead: the read
 * path notices the document is missing or stale and rebuilds it, at most once
 * per `MAX_AGE_HOURS`. The first reader after a day pays for the scan; every
 * other reader is served the document. An admin can force it from
 * /api/stats/computeClusters when a story needs to be checked now.
 */

export const CLUSTER_STATS_DOC = "employment_clusters";

/** Bumped whenever the arithmetic in `shared/clusters.ts` changes what a
 * cluster is or how it is ranked.
 *
 * A stored document is derived data, and a deploy that changes the detector
 * leaves yesterday's answers in Firestore claiming to be a day fresh - so the
 * home page would keep serving the old list for a day after the fix that
 * removed a wrong cluster from it. `activityRollup.ts` guards its rollups the
 * same way and for the same reason. */
export const CLUSTER_METHOD_VERSION = 1;

/** How old the document may get before a reader triggers a rebuild.
 *
 * A day. The underlying facts arrive in KRS batches through the pipelines, not
 * continuously, and the ranking is over a two-year window - nothing that
 * happens between two mornings can move it. `?latest=true` is what an editor
 * uses when they have just published something and want to see it counted.
 */
export const MAX_AGE_HOURS = 24;

export interface ClusterStatsDoc {
  type: "employment_clusters";
  clusters: StoryCluster[];
  /** ISO instant of the rebuild, which is what `staleness` is measured from. */
  computedAt: string;
  /** The window the clusters cover, as `YYYY-MM-DD`. */
  windowStart: string;
  windowEnd: string;
  /** Hires the detector looked at, and how many of them a logged out reader
   * could open. Shown under the list so a reader can tell a thin week from a
   * broken job. */
  hiresConsidered: number;
  hiresVisible: number;
  /** Supervisory seats left out because nobody is paid to sit on them - see
   * `isUnpaidSeat`. Reported so that a count which looks short can be
   * explained. */
  unpaidSeatsExcluded: number;
  /** Which version of the detector wrote this. Anything else is recomputed. */
  version: number;
}

/** The stored document, or null when nothing has computed it yet. */
export async function readClusterStats(
  db: FirebaseFirestore.Firestore,
): Promise<ClusterStatsDoc | null> {
  const snap = await db.collection("stats").doc(CLUSTER_STATS_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() as ClusterStatsDoc | undefined;
  if (!data || !Array.isArray(data.clusters)) return null;
  /* Written by a detector that no longer exists. Recomputed rather than
   * trusted - see `CLUSTER_METHOD_VERSION`. */
  if (data.version !== CLUSTER_METHOD_VERSION) return null;
  return data;
}

export async function writeClusterStats(
  db: FirebaseFirestore.Firestore,
  doc: ClusterStatsDoc,
): Promise<void> {
  await db.collection("stats").doc(CLUSTER_STATS_DOC).set(doc);
}

function hoursSince(iso: string, now: Date): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - at) / 3600000;
}

export function clusterStatsAreStale(
  doc: ClusterStatsDoc | null,
  now: Date,
  maxAgeHours = MAX_AGE_HOURS,
): boolean {
  if (!doc) return true;
  return hoursSince(doc.computedAt, now) >= maxAgeHours;
}

/** Every employment spell the graph can date, flattened for the detector.
 *
 * Five collections' worth of joins, done in memory because every one of them is
 * needed in full: which region a company sits in, who owns it (through however
 * many companies), what sector it is filed under, whether the person stood for
 * election there, and whether a reader may see any of it.
 *
 * `fetchNodes` is memoized for an hour per type, so the node side of this is
 * usually free; the edges are read once through a single query per type.
 */
export async function buildClusterHires(
  db: FirebaseFirestore.Firestore,
): Promise<{
  hires: ClusterHire[];
  labels: ClusterLabels;
  /** Supervisory seats dropped as unpaid, reported so the number is visible
   * rather than silently missing. */
  unpaidSeats: number;
}> {
  const [people, places, regions] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
  ]);

  /* One query per edge type rather than the whole collection. `fetchEdges()`
   * reads all 43,713 documents and is unmemoized - hospitals.get.ts calls it
   * one of the known cost sinks - and three of the eight types here are
   * `mentions`, `comment` and `tagged`, which say nothing about employment. */
  /* Projected rather than whole documents. An edge carries `references`,
   * `content` and a revision pointer that this has no use for, and the four
   * queries below are 38,000 documents between them - hospitals.get.ts makes
   * the same point about a 1.3 MB payload it was reading to count seven
   * fields. */
  const edgesByType = (type: string) =>
    db
      .collection("edges")
      .where("type", "==", type)
      .select(
        "type",
        "source",
        "target",
        "name",
        "start_date",
        "published",
        "deleted",
      )
      .get();
  const [employed, seats, owns, elections] = await Promise.all([
    edgesByType("employed"),
    edgesByType("seat"),
    edgesByType("owns"),
    edgesByType("election"),
  ]);

  const edgesOf = (snap: FirebaseFirestore.QuerySnapshot) =>
    snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Edge) }))
      /* A removed relation is still a document - /api/edges/delete writes
       * `deleted: true` rather than deleting - and 775 of the 43,656 edges on
       * the graph are in that state. Counting them would put merged-away people
       * back into every cluster they were ever in. */
      .filter((edge) => edge.deleted !== true && edge.source && edge.target);

  const seatRegionOf = new Map<string, string>();
  for (const edge of edgesOf(seats)) {
    if (!regions[edge.source]) continue;
    if (!seatRegionOf.has(edge.target))
      seatRegionOf.set(edge.target, edge.source);
  }

  /* Direct owners, split by what kind of node they are: a gmina owning its
   * wodociągi is a leaf, a company owning a company is a link in a chain. */
  const ownersOf = new Map<string, string[]>();
  for (const edge of edgesOf(owns)) {
    if (!regions[edge.source] && !places[edge.source]) continue;
    const current = ownersOf.get(edge.target);
    if (current) current.push(edge.source);
    else ownersOf.set(edge.target, [edge.source]);
  }

  /* Ownership chains, resolved the same way computeNodes.post.ts resolves them,
   * including the `visited` guard: the register contains cycles, and a company
   * that owns its own parent would otherwise recurse until the stack gave out. */
  const resolvedOwners = new Map<string, string[]>();
  const resolveOwners = (companyId: string, visited: Set<string>): string[] => {
    if (visited.has(companyId)) return [];
    visited.add(companyId);
    const out: string[] = [];
    for (const owner of ownersOf.get(companyId) ?? []) {
      out.push(owner);
      if (places[owner]) out.push(...resolveOwners(owner, visited));
    }
    return out;
  };
  for (const companyId of ownersOf.keys()) {
    resolvedOwners.set(
      companyId,
      Array.from(new Set(resolveOwners(companyId, new Set()))),
    );
  }

  /* Which regions a person has ever stood for election in. Only the region id
   * is kept: „stood here” is the claim, and a cluster is already a claim about
   * a window, so dating the candidacy as well would drop the 2018 councillor
   * who was rewarded in 2025 - which is the case worth catching. */
  const candidacies = new Map<string, Set<string>>();
  for (const edge of edgesOf(elections)) {
    if (!regions[edge.target]) continue;
    const seen = candidacies.get(edge.source);
    if (seen) seen.add(edge.target);
    else candidacies.set(edge.source, new Set([edge.target]));
  }

  /* Seats nobody is paid to hold, dropped before anything is counted.
   *
   * rejestr.io labels every supervisory connection KRS_SUPERVISION and the
   * scrapers render it as the literal role „Rada Nadzorcza”, so the edge cannot
   * tell a hospital's statutory rada społeczna from a company's paid board -
   * only the institution's own `supervisoryOrgan` can, which is why
   * `hospitalStats.ts` allow-lists `rada_nadzorcza` rather than excluding the
   * społeczna it can see. This is that rule, and it is not cosmetic: without it
   * the single strongest party cluster in the whole graph is podkarpackie's
   * hospitals at PiS 25 of 41, p=1.6e-07, of which 23 are rada społeczna seats
   * the site deliberately refuses to publish. Under the rule that cluster falls
   * to four hires and stops being the headline. */
  let unpaidSeats = 0;
  const isUnpaidSeat = (edge: Edge, company: Company): boolean => {
    if (!namesASupervisorySeat(edge.name)) return false;
    return company.supervisoryOrgan !== "rada_nadzorcza";
  };

  /* The most local body that owns the company, which is the stratum every rate
   * in `shared/clusters.ts` is measured within. Most local rather than
   * ultimate: a gmina's spółka is owned by the gmina and, through it, by
   * nothing else, while PKP Intercity's chain runs up to Skarb Państwa - and
   * what predicts who a company hires is the body actually appointing, not the
   * root of the chain. A TERYT code says which: seven digits is a gmina, four a
   * powiat, two a województwo. */
  const ownerTierOf = (owners: string[]): OwnerTier => {
    let best: OwnerTier | null = null;
    const rank: Record<OwnerTier, number> = {
      gmina: 0,
      powiat: 1,
      wojewodztwo: 2,
      panstwo: 3,
      spolka: 4,
      brak: 5,
    };
    for (const owner of owners) {
      const region = regions[owner] as Region | undefined;
      let tier: OwnerTier;
      if (region) {
        const teryt = region.teryt;
        tier =
          teryt.length >= 7
            ? "gmina"
            : teryt.length >= 4
              ? "powiat"
              : teryt.length >= 2
                ? "wojewodztwo"
                : "panstwo";
      } else if (places[owner]) {
        tier = "spolka";
      } else {
        continue;
      }
      if (best === null || rank[tier] < rank[best]) best = tier;
    }
    return best ?? "brak";
  };

  const hires: ClusterHire[] = [];
  for (const edge of edgesOf(employed)) {
    const person = people[edge.source] as Person | undefined;
    const company = places[edge.target] as Company | undefined;
    /* An employment runs person -> place. Anything else is a row the ingest
     * mislabelled, and it has no company whose region or sector to read. */
    if (!person || !company) continue;
    /* Not `edge.start_date!`: /api/edges/create writes an explicit null for a
     * blank form field, and roughly 195 hand-entered rows have no date at all.
     * A spell that cannot be placed in a window cannot be in a cluster. */
    if (typeof edge.start_date !== "string" || edge.start_date.length < 10) {
      continue;
    }
    if (isUnpaidSeat(edge, company)) {
      unpaidSeats += 1;
      continue;
    }
    const regionId = seatRegionOf.get(edge.target);
    const hire: ClusterHire = {
      edgeId: edge.id,
      personId: edge.source,
      personName: person.name,
      /* `asArray`, not the field: a node written before 2026-07-28 stores its
       * arrays as numbered-key maps, and reading one as an array silently
       * yields nothing rather than failing. */
      parties: asArray<string>(person.parties),
      companyId: edge.target,
      companyName: company.name,
      categories: asArray<string>(company.categories),
      /* Read only to settle whether two pages are the same human or the same
       * company - see `foldIdentities`. */
      ...(person.birthDate ? { birthDate: person.birthDate } : {}),
      ...(company.krsNumber ? { companyKrs: company.krsNumber } : {}),
      ownerIds: resolvedOwners.get(edge.target) ?? [],
      ownerTier: ownerTierOf(resolvedOwners.get(edge.target) ?? []),
      role: typeof edge.name === "string" ? edge.name : null,
      start: edge.start_date.slice(0, 10),
      /* The publish rule already refuses an edge whose ends are not both live,
       * and unpublishing a node cascades to its edges - but the pipelines write
       * this collection too, so the flag on the edge is not an invariant
       * anything enforces. Both endpoints are read here anyway. */
      visible:
        pageIsPublic(edge) && pageIsPublic(person) && pageIsPublic(company),
      localCandidate:
        regionId !== undefined &&
        (candidacies.get(edge.source)?.has(regionId) ?? false),
    };
    if (regionId) {
      hire.regionId = regionId;
      const region = regions[regionId] as Region | undefined;
      if (region?.name) hire.regionName = region.name;
    }
    hires.push(hire);
  }

  /* Titles for every key the detector might group on. Regions and owners are
   * nodes and are named by their node; a sector is named by the site's own
   * vocabulary, so that a card says „Sport i rekreacja” rather than „sport”. */
  const labels: ClusterLabels = { titles: {}, teryts: {} };
  for (const [id, region] of Object.entries(regions)) {
    if (region.name) labels.titles[id] = region.name;
    if (region.teryt) labels.teryts![id] = region.teryt;
  }
  for (const [id, place] of Object.entries(places)) {
    if (place.name) labels.titles[id] = place.name;
  }
  for (const hire of hires) {
    for (const category of hire.categories) {
      labels.titles[category] = categoryTitle(category);
    }
  }

  return { hires, labels, unpaidSeats };
}

/** Recompute the clusters and store them. Returns what was stored. */
export async function rebuildClusterStats(
  db: FirebaseFirestore.Firestore,
  now: Date,
): Promise<ClusterStatsDoc> {
  const { hires, labels, unpaidSeats } = await buildClusterHires(db);
  const today = now.toISOString().slice(0, 10);
  const clusters = computeStoryClusters(hires, today, labels);
  const windowStart =
    clusters.length > 0
      ? clusters.reduce(
          (earliest, cluster) =>
            cluster.firstStart < earliest ? cluster.firstStart : earliest,
          today,
        )
      : today;

  const doc: ClusterStatsDoc = {
    type: "employment_clusters",
    clusters,
    computedAt: now.toISOString(),
    windowStart,
    windowEnd: today,
    hiresConsidered: hires.length,
    hiresVisible: hires.filter((hire) => hire.visible).length,
    unpaidSeatsExcluded: unpaidSeats,
    version: CLUSTER_METHOD_VERSION,
  };
  await writeClusterStats(db, doc);
  return doc;
}

/** A rebuild already running in this container, so that the several requests
 * that arrive while it works do not each start one of their own. Not a lock -
 * two containers can still rebuild at once, and the write is idempotent - just
 * the cheap half of one. */
let rebuildInFlight: Promise<ClusterStatsDoc> | null = null;

function rebuildOnce(
  db: FirebaseFirestore.Firestore,
  now: Date,
): Promise<ClusterStatsDoc> {
  rebuildInFlight ??= rebuildClusterStats(db, now).finally(() => {
    rebuildInFlight = null;
  });
  return rebuildInFlight;
}

/** The stored clusters, rebuilt if they are missing or a day old.
 *
 * A stale document is served as it stands and the rebuild runs behind the
 * response. The scan reads most of two collections - 38,000 edge documents and
 * 15,000 nodes - and the reader who happens to be first through the door the
 * morning after would otherwise wait several seconds for a section of the home
 * page that was going to be a day out of date either way. Only an empty store
 * is worth blocking for, because there is nothing to show instead.
 *
 * Best effort, like `ensureDailyRollups`: a rebuild that fails leaves whatever
 * was stored before in place.
 */
export async function ensureClusterStats(
  db: FirebaseFirestore.Firestore,
  now: Date,
  maxAgeHours = MAX_AGE_HOURS,
): Promise<ClusterStatsDoc | null> {
  const stored = await readClusterStats(db);
  if (!clusterStatsAreStale(stored, now, maxAgeHours)) return stored;

  if (stored) {
    void rebuildOnce(db, now).catch((error: unknown) => {
      console.error("[clusterStats] background rebuild failed", error);
    });
    return stored;
  }

  return rebuildOnce(db, now);
}

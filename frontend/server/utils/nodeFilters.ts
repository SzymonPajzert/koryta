/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO remove this and fix the typing

import { applyPartiesFilter, fetchNodes } from "~~/server/utils/fetch";
import { asArray } from "~~/shared/model";
import { isInWojewodztwo, isWojewodztwoTeryt } from "~~/shared/teryt";
import { electionResultKey, type ElectionResult } from "~~/shared/electionDays";

// Still exported from here, which is where every caller and half the comments
// in the repo look for it. The definition moved to `shared/model` so that a
// handler wanting nothing but the array can have it without importing this
// module's Firestore cache - and so that the edit form and the migration
// scripts, which read the same fields off the same documents, cannot end up
// with a second copy that does not cope with the map shape.
export { asArray };

/** A node filter that can run either as a Firestore clause or in memory.
 * Firestore application can fail on missing indexes or on combining multiple
 * array filters, in which case callers fall back to `applyMem`.
 */
export type NodeFilterOp = {
  applyFs: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query;
  applyMem: (nodes: any[]) => any[];
  /** Document fields `applyMem` reads. Declared so that a caller which
   * projects its Firestore query knows what to ask for - a field left out of
   * the projection reads back as undefined and the filter silently drops
   * everything. Callers that fetch whole documents can ignore it. */
  fields?: string[];
};

export type StructuralQuery = {
  type?: string;
  party?: string;
  parties?: string | string[];
  teryt?: string;
  /** Region the person's *employer* is seated in, as opposed to `teryt`, which
   * matches any tie the person has to a region (a job, but also an election). */
  companyTeryt?: string;
  krs?: string | string[];
  /** Employer, by place node id. The identifier the table filters on: an
   * institution without a KRS number - a ministry, an urząd - has no other one. */
  place?: string | string[];
  category?: string;
  currentlyEmployed?: "all" | "any" | "selected";
  minEmploymentDate?: string;
  minVotes?: number;
  /** Difficulty tier, as `stats.queueTier` on the person - see
   * shared/queueTiers.ts. */
  queueTier?: number;
  /** General elections the person stood in, as `ElectionKey`s
   * („parliament-2023”). Several mean any of them. */
  election?: string | string[];
  /** Narrows `election` to the people it gave a seat, or to those who lost
   * every run in it. Means nothing without an election. */
  electionResult?: ElectionResult;
};

/** A query parameter that may arrive once, repeated, or not at all. */
function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function edgeTargetsField(
  edgeScope: "all" | "approved",
  currentlyEmployed?: string,
) {
  return currentlyEmployed === "selected"
    ? `stats.edges.${edgeScope}.currentlyEmployedTargetNodeIds`
    : `stats.edges.${edgeScope}.targetNodeIds`;
}

function memTargets(
  node: any,
  edgeScope: "all" | "approved",
  currentlyEmployed?: string,
): string[] {
  const edges = node.stats?.edges?.[edgeScope];
  const arr =
    currentlyEmployed === "selected"
      ? edges?.currentlyEmployedTargetNodeIds
      : edges?.targetNodeIds;
  return Array.isArray(arr) ? arr : [];
}

/** An op whose Firestore form is unusable (too many values, or a second array
 * filter in one query); the thrown message contains "index" on purpose so the
 * caller's fallback loop degrades it to the in-memory version. */
function memOnly(applyMem: NodeFilterOp["applyMem"]): NodeFilterOp {
  return {
    applyFs: () => {
      throw new Error("index: filter not supported in Firestore query");
    },
    applyMem,
  };
}

/** Builds the "structural" filters of the person table (everything except
 * visibility/voting status and sorting), shared between /api/nodes and
 * /api/stats/progress.
 *
 * Returns `empty: true` when a filter value resolves to nothing (e.g. an
 * unknown KRS number), meaning the result set is empty regardless of the
 * other filters. `fields` is the union of what the ops read, for callers that
 * project their query - see `NodeFilterOp.fields`. `targetIds` are the place
 * and region ids the company and region filters resolved to, absent when
 * neither is set - see `matchedTargets`.
 */
export async function buildStructuralFilterOps(
  db: FirebaseFirestore.Firestore,
  query: StructuralQuery,
  edgeScope: "all" | "approved",
): Promise<{
  ops: NodeFilterOp[];
  fields: string[];
  empty: boolean;
  targetIds?: string[];
}> {
  const ops: NodeFilterOp[] = [];
  // Every id a `targetNodesOp` below was handed. Place and region node ids
  // cannot collide, so the two filters share one list.
  let targetIds: string[] | undefined;
  const result = (empty: boolean) => ({
    ops,
    fields: [...new Set(ops.flatMap((op) => op.fields ?? []))],
    empty,
    targetIds,
  });
  // Firestore allows only one array-contains/array-contains-any clause per
  // query, so once one op uses it, later array ops must run in memory.
  let arrayFilterUsed = false;

  if (query.type) {
    ops.push({
      applyFs: (q) => q.where("type", "==", query.type),
      applyMem: (nodes) => nodes.filter((n) => n.type === query.type),
      fields: ["type"],
    });
  }

  const partiesToFilter = query.parties || query.party;
  if (partiesToFilter) {
    const partiesToSearch = Array.isArray(partiesToFilter)
      ? partiesToFilter
      : [partiesToFilter];
    const hasNone = partiesToSearch.includes("__NONE__");
    const normalParties = partiesToSearch.filter((p) => p !== "__NONE__");
    if (normalParties.length > 0) {
      arrayFilterUsed = true;
    }
    ops.push({
      applyFs: (q) => applyPartiesFilter(q, partiesToFilter),
      applyMem: (nodes) =>
        nodes.filter((n) => {
          const p = asArray<string>(n.parties);
          if (hasNone && p.length === 0) return true;
          if (
            normalParties.length > 0 &&
            p.some((party) => normalParties.includes(party))
          )
            return true;
          return false;
        }),
      fields: ["parties"],
    });
  }

  // Filters that describe the company a person is connected to. They are
  // intersected rather than pushed as separate ops, because they all constrain
  // the *same* company: "a hospital, in mazowieckie" has to mean one place
  // satisfying both, not a hospital anywhere plus an unrelated tie to the
  // region.
  const placeIdSets: string[][] = [];

  // `place` and `krs` name the same dimension - which employer - by two
  // identifiers, so they union into one set instead of intersecting like the
  // filters below. `krs` is kept for links minted before institutions without a
  // KRS number became selectable.
  if (query.place || query.krs) {
    const placeIds = new Set(toArray(query.place));
    const krsArray = [...new Set(toArray(query.krs))];
    for (let i = 0; i < krsArray.length; i += 10) {
      const chunk = krsArray.slice(i, i + 10);
      const chunkPlaces = await db
        .collection("nodes")
        .where("type", "==", "place")
        .where("krsNumber", "in", chunk)
        .get();
      for (const doc of chunkPlaces.docs) {
        placeIds.add(doc.id);
      }
    }
    placeIdSets.push([...placeIds]);
  }

  if (query.category) {
    // Category -> place ids is resolved in memory from the cached place list:
    // `categories` on place nodes may be stored sanitized (as an object), so
    // it cannot be queried with array-contains.
    const places = await fetchNodes("place");
    placeIdSets.push(
      Object.entries(places)
        .filter(([, place]) =>
          asArray<string>(place.categories).includes(query.category!),
        )
        .map(([id]) => id),
    );
  }

  if (query.companyTeryt) {
    const regionIds = await resolveRegionIds(db, query.companyTeryt);
    placeIdSets.push(
      regionIds.length === 0 ? [] : await placesInRegions(db, regionIds),
    );
  }

  if (placeIdSets.length > 0) {
    const placeIds = intersectAll(placeIdSets);
    if (placeIds.length === 0) {
      return result(true);
    }
    ops.push(targetNodesOp(placeIds, query, edgeScope, arrayFilterUsed));
    targetIds = placeIds;
    arrayFilterUsed = true;
  }

  if (query.teryt) {
    const regionIds = await resolveRegionIds(db, query.teryt);
    if (regionIds.length === 0) {
      return result(true);
    }
    ops.push(targetNodesOp(regionIds, query, edgeScope, arrayFilterUsed));
    targetIds = [...(targetIds ?? []), ...regionIds];
    // Every op that consumes the array-filter slot has to claim it, or the
    // next filter below - the election - reads a stale false.
    arrayFilterUsed = true;
  }

  if (query.currentlyEmployed === "any") {
    const field = `stats.edges.${edgeScope}.currentlyEmployed`;
    ops.push({
      applyFs: (q) => q.where(field, "==", true),
      applyMem: (nodes) =>
        nodes.filter(
          (n) => n.stats?.edges?.[edgeScope]?.currentlyEmployed === true,
        ),
      fields: [field],
    });
  }

  if (query.minEmploymentDate) {
    const minDate = query.minEmploymentDate;
    const field = `stats.edges.${edgeScope}.latestEmploymentStart`;
    ops.push({
      applyFs: (q) => q.where(field, ">=", minDate),
      applyMem: (nodes) =>
        nodes.filter((n) => {
          const val = n.stats?.edges?.[edgeScope]?.latestEmploymentStart;
          return typeof val === "string" && val >= minDate;
        }),
      fields: [field],
    });
  }

  if (query.minVotes != null) {
    const minVotes = query.minVotes;
    ops.push({
      applyFs: (q) => q.where("stats.votes.interesting", ">=", minVotes),
      applyMem: (nodes) =>
        nodes.filter((n) => (n.stats?.votes?.interesting ?? 0) >= minVotes),
      fields: ["stats.votes.interesting"],
    });
  }

  if (query.queueTier != null) {
    const queueTier = query.queueTier;
    ops.push({
      applyFs: (q) => q.where("stats.queueTier", "==", queueTier),
      // A person the tier computation has not reached carries no
      // `stats.queueTier` at all, and neither form matches one: Firestore
      // does not match a document lacking the field, and `undefined === 1` is
      // false. Both leave them out of the tier rather than in it.
      applyMem: (nodes) =>
        nodes.filter((n) => n.stats?.queueTier === queueTier),
      fields: ["stats.queueTier"],
    });
  }

  // Last, and the last to claim the array-filter slot: with a party, a place or
  // a region set as well, the election narrows in memory whatever those let
  // through. A memory-only op also takes every op after it out of Firestore
  // with it (the caller's fallback drops ops from the end until the query
  // runs), and here there are none.
  const outcome = query.electionResult;
  const elections = [...new Set(toArray(query.election))].map((key) =>
    outcome ? electionResultKey(key, outcome) : key,
  );
  if (elections.length > 0) {
    const field = `stats.edges.${edgeScope}.elections`;
    const applyMem = (nodes: any[]) =>
      nodes.filter((n) =>
        asArray<string>(n.stats?.edges?.[edgeScope]?.elections).some((key) =>
          elections.includes(key),
        ),
      );
    // array-contains-any takes up to 30 values, and nothing else in this query
    // is a disjunction once the slot is free - so all 25 elections the filter
    // offers fit, and picking every one of them never reads each person into
    // memory to compare.
    ops.push(
      arrayFilterUsed || elections.length > 30
        ? { ...memOnly(applyMem), fields: [field] }
        : {
            applyFs: (q) => q.where(field, "array-contains-any", elections),
            applyMem,
            fields: [field],
          },
    );
    // Nothing reads this today, but every op that consumes the array-filter
    // slot has to claim it, or the next filter added below reads a stale false.
    // eslint-disable-next-line no-useless-assignment
    arrayFilterUsed = true;
  }

  return result(false);
}

/** Region node ids a `teryt` filter covers.
 *
 * A powiat or gmina code identifies a single region. A województwo code covers
 * the whole voivodeship: the województwo node itself - some people, such as
 * sejmik members, hang off it directly - plus every powiat and gmina inside it.
 * Without that expansion picking a województwo returned only the handful of
 * people attached at voivodeship level.
 */
async function resolveRegionIds(
  db: FirebaseFirestore.Firestore,
  teryt: string,
): Promise<string[]> {
  if (isWojewodztwoTeryt(teryt)) {
    // Cached, and only a few hundred documents.
    const regions = await fetchNodes("region");
    return Object.entries(regions)
      .filter(([, region]) => isInWojewodztwo(region.teryt, teryt))
      .map(([id]) => id);
  }

  const regions = await db
    .collection("nodes")
    .where("type", "==", "region")
    .where("teryt", "==", teryt)
    .limit(1)
    .get();
  return regions.empty ? [] : [regions.docs[0]!.id];
}

function intersectAll(sets: string[][]): string[] {
  return sets.reduce((acc, next) => {
    const allowed = new Set(next);
    return acc.filter((id) => allowed.has(id));
  });
}

/** Place node ids seated in any of the given regions.
 *
 * Location is stored as an `owns` edge from the region to the company, written
 * by the company ingest from the company's registered seat. Read from the edges
 * rather than from the places' own stats, so the filter works without waiting
 * for the stats job to run.
 *
 * The region hierarchy (województwo owns powiat) lives in the same collection
 * with the same edge type, so region targets are dropped - otherwise a person
 * tied to a powiat by an election would look like an employee of it.
 */
async function placesInRegions(
  db: FirebaseFirestore.Firestore,
  regionIds: string[],
): Promise<string[]> {
  const allRegionIds = new Set(Object.keys(await fetchNodes("region")));
  const placeIds = new Set<string>();
  // `in` takes at most 30 values, and a województwo covers far more regions.
  for (let i = 0; i < regionIds.length; i += 30) {
    const chunk = regionIds.slice(i, i + 30);
    const snapshot = await db
      .collection("edges")
      .where("source", "in", chunk)
      .get();
    for (const doc of snapshot.docs) {
      const edge = doc.data();
      // The filter is „Siedziba spółki", so it wants seats. `owns` is still
      // accepted while the migration runs; once no region->place `owns` edge is
      // left it can be dropped, and until then a region that owns a company
      // elsewhere shows it here - which is what the site did for every company
      // before the split anyway.
      //
      // A removed seat is not a seat. `/api/edges/delete` lets an admin take
      // any relation off the graph, and it is a soft delete - the document
      // stays, carrying `deleted: true` - so without this a seat somebody has
      // removed goes on placing the company in that region forever.
      //
      // `deleted` rather than `pageIsPublic`: an unpublished seat still says
      // where a company is, and this filter runs for signed-in readers too.
      if (
        (edge.type === "seat" || edge.type === "owns") &&
        edge.deleted !== true &&
        edge.target &&
        !allRegionIds.has(edge.target)
      ) {
        placeIds.add(edge.target as string);
      }
    }
  }
  return [...placeIds];
}

/** For each node, which of `targetIds` let it through: the employers and
 * regions behind a row, so the table can mark them among everything else the
 * row lists.
 *
 * Read off the same arrays `targetNodesOp` matches against, and narrowed the
 * same way by `currentlyEmployed`, so what a row marks is exactly what put it
 * on the page - including the current-post rule and the regions folded in
 * above a company, which the browser has no copy of. A node none of them
 * reached is left out rather than given an empty list. */
export function matchedTargets(
  nodes: any[],
  targetIds: string[],
  edgeScope: "all" | "approved",
  currentlyEmployed?: string,
): Record<string, string[]> {
  const wanted = new Set(targetIds);
  const matched: Record<string, string[]> = {};
  for (const node of nodes) {
    const hits = memTargets(node, edgeScope, currentlyEmployed).filter((id) =>
      wanted.has(id),
    );
    if (hits.length > 0) matched[node.id] = hits;
  }
  return matched;
}

/** What to call the places among `ids`, from the cached place list.
 *
 * `targetNodeIds` carries every company above a person's employer as well as
 * the employer itself, so a person can be in a sector only because the company
 * they work for is owned by one in it - in energetyka that is 722 of 1,596
 * people on the 2026-10-29 export, none of whose own employers is filed under
 * the sector. Their row has no company of its own to mark, so it names the one
 * that brought them in, and needs the name to do it. Region ids are skipped,
 * and so are drafts for a reader who may not see them. */
export async function placeNames(
  ids: string[],
  showDrafts: boolean,
): Promise<Record<string, string>> {
  const places = await fetchNodes("place");
  const names: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const place = places[id];
    if (!place?.name || (!showDrafts && !place.visibility)) continue;
    names[id] = place.name;
  }
  return names;
}

/** Filter to people connected to any of the given place/region node ids. */
function targetNodesOp(
  placeIds: string[],
  query: StructuralQuery,
  edgeScope: "all" | "approved",
  arrayFilterUsed: boolean,
): NodeFilterOp {
  const applyMem = (nodes: any[]) =>
    nodes.filter((n) =>
      memTargets(n, edgeScope, query.currentlyEmployed).some((id) =>
        placeIds.includes(id),
      ),
    );
  const arrayField = edgeTargetsField(edgeScope, query.currentlyEmployed);

  // array-contains-any accepts at most 10 values
  if (arrayFilterUsed || placeIds.length > 10) {
    return { ...memOnly(applyMem), fields: [arrayField] };
  }
  return {
    applyFs: (q) => q.where(arrayField, "array-contains-any", placeIds),
    applyMem,
    fields: [arrayField],
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO remove this and fix the typing

import { applyPartiesFilter, fetchNodes } from "~~/server/utils/fetch";
import { isInWojewodztwo, isWojewodztwoTeryt } from "~~/shared/teryt";

/** A node filter that can run either as a Firestore clause or in memory.
 * Firestore application can fail on missing indexes or on combining multiple
 * array filters, in which case callers fall back to `applyMem`.
 */
export type NodeFilterOp = {
  applyFs: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query;
  applyMem: (nodes: any[]) => any[];
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
  category?: string;
  currentlyEmployed?: "all" | "any" | "selected";
  minEmploymentDate?: string;
  minVotes?: number;
};

/** Node data written through sanitizeFirestoreData stores arrays as objects
 * with numbered keys, so array fields have to be read tolerantly. */
export function asArray<T>(
  value: T[] | Record<string, T> | undefined | null,
): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
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
 * other filters.
 */
export async function buildStructuralFilterOps(
  db: FirebaseFirestore.Firestore,
  query: StructuralQuery,
  edgeScope: "all" | "approved",
): Promise<{ ops: NodeFilterOp[]; empty: boolean }> {
  const ops: NodeFilterOp[] = [];
  // Firestore allows only one array-contains/array-contains-any clause per
  // query, so once one op uses it, later array ops must run in memory.
  let arrayFilterUsed = false;

  if (query.type) {
    ops.push({
      applyFs: (q) => q.where("type", "==", query.type),
      applyMem: (nodes) => nodes.filter((n) => n.type === query.type),
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
    });
  }

  // Filters that describe the company a person is connected to. They are
  // intersected rather than pushed as separate ops, because they all constrain
  // the *same* company: "a hospital, in mazowieckie" has to mean one place
  // satisfying both, not a hospital anywhere plus an unrelated tie to the
  // region.
  const placeIdSets: string[][] = [];

  if (query.krs) {
    const krsArray = [
      ...new Set(Array.isArray(query.krs) ? query.krs : [query.krs]),
    ];
    const places: any[] = [];
    for (let i = 0; i < krsArray.length; i += 10) {
      const chunk = krsArray.slice(i, i + 10);
      const chunkPlaces = await db
        .collection("nodes")
        .where("type", "==", "place")
        .where("krsNumber", "in", chunk)
        .get();
      places.push(...chunkPlaces.docs);
    }
    placeIdSets.push(places.map((doc) => doc.id));
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
      return { ops, empty: true };
    }
    ops.push(targetNodesOp(placeIds, query, edgeScope, arrayFilterUsed));
    arrayFilterUsed = true;
  }

  if (query.teryt) {
    const regionIds = await resolveRegionIds(db, query.teryt);
    if (regionIds.length === 0) {
      return { ops, empty: true };
    }
    ops.push(targetNodesOp(regionIds, query, edgeScope, arrayFilterUsed));
    // Nothing reads this today, but every op that consumes the array-filter
    // slot has to claim it, or the next filter added below reads a stale false.
    // eslint-disable-next-line no-useless-assignment
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
    });
  }

  if (query.minVotes != null) {
    const minVotes = query.minVotes;
    ops.push({
      applyFs: (q) => q.where("stats.votes.interesting", ">=", minVotes),
      applyMem: (nodes) =>
        nodes.filter((n) => (n.stats?.votes?.interesting ?? 0) >= minVotes),
    });
  }

  return { ops, empty: false };
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
      if (
        edge.type === "owns" &&
        edge.target &&
        !allRegionIds.has(edge.target)
      ) {
        placeIds.add(edge.target as string);
      }
    }
  }
  return [...placeIds];
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

  // array-contains-any accepts at most 10 values
  if (arrayFilterUsed || placeIds.length > 10) {
    return memOnly(applyMem);
  }
  const arrayField = edgeTargetsField(edgeScope, query.currentlyEmployed);
  return {
    applyFs: (q) => q.where(arrayField, "array-contains-any", placeIds),
    applyMem,
  };
}

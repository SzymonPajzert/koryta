/* eslint-disable @typescript-eslint/no-explicit-any */
// TODO remove this and fix the typing

import { applyPartiesFilter } from "~~/server/utils/fetch";

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
  krs?: string | string[];
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

    if (places.length === 0) {
      return { ops, empty: true };
    }
    const placeIds = places.map((doc) => doc.id);
    ops.push(targetNodesOp(placeIds, query, edgeScope, arrayFilterUsed));
    arrayFilterUsed = true;
  }

  if (query.teryt) {
    const regions = await db
      .collection("nodes")
      .where("type", "==", "region")
      .where("teryt", "==", query.teryt)
      .limit(1)
      .get();
    if (regions.empty) {
      return { ops, empty: true };
    }
    const regionId = regions.docs[0]!.id;
    const applyMem = (nodes: any[]) =>
      nodes.filter((n) =>
        memTargets(n, edgeScope, query.currentlyEmployed).includes(regionId),
      );
    if (arrayFilterUsed) {
      ops.push(memOnly(applyMem));
    } else {
      const arrayField = edgeTargetsField(edgeScope, query.currentlyEmployed);
      ops.push({
        applyFs: (q) => q.where(arrayField, "array-contains", regionId),
        applyMem,
      });
      arrayFilterUsed = true;
    }
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

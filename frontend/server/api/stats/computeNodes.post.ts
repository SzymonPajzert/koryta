import { getFirestore } from "firebase-admin/firestore";
import type { Query, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import type {
  Edge,
  Note,
  VoteDocument,
  Person,
  Company,
  Region,
  Node,
  Revision,
  StoredSearchLines,
} from "~~/shared/model";
import {
  computeRevisionsObj,
  normalizeUpdateTime,
  type RevisionMinimal,
} from "~~/shared/revisions";
import { computeNodeStats } from "~~/shared/stats";
import { queueTier } from "~~/shared/queueTiers";
import { pageIsPublic } from "~~/shared/model";
import { unpaidSeatsByPlace, type UnpaidSeats } from "~~/shared/companyBodies";
import { getEdges, getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";
import {
  isPowiat,
  partyCounts,
  regionStat,
  writeRegionStats,
  type RegionStat,
} from "~~/server/utils/regionStats";
import { dropCachedResponses } from "~~/server/utils/cachedResponses";
import { writtenByImportOrReviewed } from "~~/server/utils/provenance";
import {
  storedSearchLines,
  type LineTarget,
  type LineTargets,
} from "~~/shared/searchLine";

/** What this handler and the helpers it calls read of each collection, and
 * nothing else. A node's search chunks and old stats, and the snapshot each
 * revision carries, are most of the bytes and nothing here reads them. A field
 * left off reads as absent and changes the output without an error, so a
 * helper that starts reading another field needs it added here. */
const FIELDS = {
  nodes: [
    "type",
    "name",
    "published",
    "deleted",
    "revision_id",
    // Regions: the search line and the region rows.
    "teryt",
    // Places: which posts count.
    "isPublic",
    "supervisoryBody",
    "paidSeats",
    // People: queueTier.
    "wikipedia",
    "rejestrIo",
    // People: the party counts on the home map's powiat rows.
    "parties",
    // getNodeGroups leaves a hidden node out of a group.
    "hide",
  ],
  edges: [
    "type",
    "source",
    "target",
    "published",
    "deleted",
    "revision_id",
    "name",
    "start_date",
    "end_date",
    "position",
    "elected",
    "by_election",
  ],
  notes: ["nodeId", "sources"],
  votes: ["nodeId", "userUid", "updatedAt", "categoryVotes"],
  revisions: ["node_id", "nodeId", "update_time", "update_automatic"],
  // `fact_type` is what `queueTier` files a person by.
  extractions: ["personNodeId", "fact_type"],
};

/** Updates sent before waiting for them to land, so that no more than this
 * many computed updates sit in memory behind the writer's throttle. */
const FLUSH_EVERY = 500;

/** A query's documents one at a time, as the server sends them, so none of
 * the collection is held as snapshots. */
function streamed(query: Query): AsyncIterable<QueryDocumentSnapshot> {
  return query.stream() as unknown as AsyncIterable<QueryDocumentSnapshot>;
}

function calculateTransitiveTargets(
  nodeEdges: Edge[],
  placeToRegions: Record<string, string[]>,
  resolvedPlaceToParentCompanies: Record<string, string[]>,
): Record<string, string[]> {
  const transitiveTargets: Record<string, string[]> = {};
  for (const edge of nodeEdges) {
    if (edge.target) {
      const parents = [];
      if (placeToRegions[edge.target]) {
        parents.push(...placeToRegions[edge.target]!);
      }
      if (resolvedPlaceToParentCompanies[edge.target]) {
        parents.push(...resolvedPlaceToParentCompanies[edge.target]!);
      }
      if (parents.length > 0) {
        transitiveTargets[edge.target] = parents;
      }
    }
  }
  return transitiveTargets;
}

function buildNodeUpdateData(
  node: { id: string; data: Node },
  nodeEdges: Edge[],
  nodeNotes: Note[],
  nodeVotes: VoteDocument[],
  nodeRevisions: RevisionMinimal[],
  placeToRegions: Record<string, string[]>,
  resolvedPlaceToParentCompanies: Record<string, string[]>,
  nodeGroupSizeMap: Record<string, number>,
  targetCounts: Record<string, Set<string>>,
  publicPlaceIds: ReadonlySet<string>,
  unpaidSeats: ReadonlyMap<string, UnpaidSeats>,
  nodeFactsCount: number,
  nodeFactTypes: ReadonlySet<string>,
  searchLines: (
    node: { id: string; data: Node },
    edges: Edge[],
  ) => StoredSearchLines,
) {
  const transitiveTargets = calculateTransitiveTargets(
    nodeEdges,
    placeToRegions,
    resolvedPlaceToParentCompanies,
  );

  const stats = computeNodeStats(
    pageIsPublic(node.data),
    nodeEdges,
    nodeNotes,
    nodeVotes,
    publicPlaceIds,
    transitiveTargets,
    unpaidSeats,
    nodeFactsCount,
    node.id,
  );

  stats.nodeGroupSize = nodeGroupSizeMap[node.id] || 0;
  if (node.data.type === "person") {
    stats.queueTier = queueTier(
      node.data as Person,
      nodeEdges,
      publicPlaceIds,
      nodeFactTypes,
    );
    // Left off a person with no line in any scope: `stats` is written whole,
    // so an earlier line goes with it.
    const lines = searchLines(node, nodeEdges);
    if (Object.keys(lines).length > 0) stats.searchLine = lines;
  }
  if (node.data.type === "region") {
    stats.people = targetCounts[node.id]?.size || 0;
  }

  const revisionsObj = computeRevisionsObj(
    node.data.revision_id,
    nodeRevisions,
  );

  return {
    stats,
    revisions: revisionsObj,
  };
}

export default defineEventHandler(async (event) => {
  // Reads every node, edge, note, vote and revision and writes back to every
  // node, so an open one is both a way to run up the bill and a way to
  // overwrite the counters the whole site is filtered and ordered by. An admin,
  // or the datascience group: a recount writes no more than its imports
  // already do, and the night's robot runs one after its uploads (decision on
  // 2026-11-18).
  const user = await getUser(event);
  if (user.admin !== true && user.datascience !== true) {
    throw createError({
      statusCode: 403,
      message:
        "Ta operacja jest dostępna tylko dla administratorów i grupy datascience.",
    });
  }

  const db = getFirestore("koryta-pl");
  // One collection at a time, each document dropped once its fields are
  // copied out, so the peak is what is kept rather than every snapshot.
  const read = (collection: keyof typeof FIELDS) =>
    streamed(db.collection(collection).select(...FIELDS[collection]));

  const nodes: { id: string; data: Node }[] = [];
  for await (const doc of read("nodes")) {
    nodes.push({ id: doc.id, data: doc.data() as Node });
  }
  // With their ids, which the search line reads a post's first revision by.
  const edges: Edge[] = [];
  for await (const doc of read("edges")) {
    edges.push({ ...doc.data(), id: doc.id } as Edge);
  }
  const notes: Note[] = [];
  for await (const doc of read("notes")) notes.push(doc.data() as Note);
  const votes: VoteDocument[] = [];
  for await (const doc of read("votes")) votes.push(doc.data() as VoteDocument);

  const nodesRecord: Record<string, Node> = {};
  for (const n of nodes) {
    nodesRecord[n.id] = n.data;
  }

  // Group data by nodeId
  const edgesByNode: Record<string, Edge[]> = {
    ...extractByNode(edges as Edge[], (edge) => [edge.source, edge.target]),
  };

  const notesByNode = extractByNode<Note>(notes as Note[], (note) => [
    note.nodeId,
  ]);
  const votesByNode = extractByNode<VoteDocument>(
    votes as VoteDocument[],
    // Extraction votes carry extractionId instead and don't belong to a node.
    (vote) => (vote.nodeId ? [vote.nodeId] : []),
  );

  // Facts per person. `/api/ingest/extraction` keeps this counter current one
  // batch at a time; here it is recomputed from the collection, which is what
  // repairs a node whose ingest-time update failed - and what stops this
  // handler from wiping the field, since it writes `stats` as a whole map.
  const factsByNode: Record<string, number> = {};
  const factTypesByNode: Record<string, Set<string>> = {};
  for await (const doc of read("extractions")) {
    const personNodeId = doc.get("personNodeId") as string | undefined;
    if (personNodeId) {
      factsByNode[personNodeId] = (factsByNode[personNodeId] ?? 0) + 1;
      const factType = doc.get("fact_type") as string | undefined;
      if (factType) {
        (factTypesByNode[personNodeId] ??= new Set()).add(factType);
      }
    }
  }
  const noFactTypes: ReadonlySet<string> = new Set();

  // Each node's revisions as `computeRevisionsObj` reads them. And the first
  // revision of every document, which is what says whether an import wrote it
  // - the rule the teaser route reads it by, one query per document, kept here
  // in one pass (server/utils/provenance.ts).
  const revisionsByNode: Record<string, RevisionMinimal[]> = {};
  const firstRevisions: Record<
    string,
    { at: string; update_automatic?: unknown }
  > = {};
  for await (const doc of read("revisions")) {
    const rev = doc.data() as Revision;
    const at = normalizeUpdateTime(rev.update_time);
    const nId = rev.node_id || rev.nodeId;
    if (nId) {
      if (!revisionsByNode[nId]) revisionsByNode[nId] = [];
      revisionsByNode[nId].push({ id: doc.id, update_time: at });
    }
    const id = rev.node_id;
    if (!id || at === null) continue;
    const first = firstRevisions[id];
    if (!first || at < first.at) {
      firstRevisions[id] = { at, update_automatic: rev.update_automatic };
    }
  }

  // Compute Node Groups

  const peopleMap: Record<string, Person> = {};
  const placesMap: Record<string, Company> = {};
  const regionsMap: Record<string, Region> = {};

  for (const n of nodes) {
    if (n.data.type === "person") peopleMap[n.id] = n.data as Person;
    else if (n.data.type === "place") placesMap[n.id] = n.data as Company;
    else if (n.data.type === "region") regionsMap[n.id] = n.data as Region;
  }

  // Confirmed public only. `isPublic` being false or absent means nobody could
  // tell (see `Company.isPublic`), and counting the unknown as public would
  // sweep in every cech, izba gospodarcza and private company the scrapers also
  // could not place. Corrections arrive as edits, not as a changed default.
  const publicPlaceIds = new Set(
    Object.entries(placesMap)
      .filter(([, place]) => place.isPublic === true)
      .map(([id]) => id),
  );

  // Institutions where some posts are not jobs: the SPZOZ hospitals, whose
  // rada społeczna nobody is paid to sit on, and those whose statute pays
  // nobody at all (`paidSeats`). Such a post is dropped from the employment
  // counters the same way a post at a place nobody could show is publicly
  // owned is.
  const unpaidSeats = unpaidSeatsByPlace(Object.entries(placesMap));

  const nodesNoStats = getNodesNoStats(
    peopleMap,
    placesMap,
    regionsMap,
    partyColors,
  );
  const formattedEdges = getEdges(edges as Edge[]);
  const nodeGroups = getNodeGroups(
    nodesNoStats,
    formattedEdges,
    peopleMap,
    placesMap,
    regionsMap,
  );

  const nodeGroupSizeMap: Record<string, number> = {};
  for (const group of nodeGroups) {
    nodeGroupSizeMap[group.id] = group.stats.people;
  }

  const placeToRegions: Record<string, string[]> = {};
  const placeToParentCompanies: Record<string, string[]> = {};

  for (const edge of edges) {
    // `seat` as well as `owns`: a person's `targetNodeIds` carries the region
    // of their employer through this fold, and 6,632 of the 7,289 people on the
    // site reach their region only that way. Reading `owns` alone here after
    // the seat edges were retyped would empty /eksploruj?teryt= for all of them.
    if (
      (edge.type === "owns" || edge.type === "seat") &&
      // A removed tie carries nothing up. `/api/edges/delete` writes
      // `deleted: true` rather than removing the document, so without this a
      // relation an admin has taken off the graph still folds its region - or
      // its parent company - into every employee's `targetNodeIds`, in the
      // `approved` scope as much as in `all`, because `transitiveTargets` is
      // built once from this map and neither scope filters it again.
      edge.deleted !== true &&
      edge.source &&
      edge.target
    ) {
      const sourceType = nodesRecord[edge.source]?.type;
      if (sourceType === "region") {
        if (!placeToRegions[edge.target]) placeToRegions[edge.target] = [];
        placeToRegions[edge.target]!.push(edge.source);
      } else if (sourceType === "place") {
        if (!placeToParentCompanies[edge.target])
          placeToParentCompanies[edge.target] = [];
        placeToParentCompanies[edge.target]!.push(edge.source);
      }
    }
  }

  // What the search line reads of a company besides its name: the region its
  // `seat` edge comes from and the regions that own it, for a town where the
  // name carries none (shared/searchLine.ts). The same live edges as above,
  // kept apart by kind.
  const seatOf: Record<string, string> = {};
  const ownersOf: Record<string, string[]> = {};
  for (const edge of edges) {
    if (edge.deleted === true || !edge.source || !edge.target) continue;
    if (nodesRecord[edge.source]?.type !== "region") continue;
    if (edge.type === "seat") seatOf[edge.target] ??= edge.source;
    else if (edge.type === "owns")
      (ownersOf[edge.target] ??= []).push(edge.source);
  }
  const lineTargets: LineTargets = {
    get: (id) => {
      const node = nodesRecord[id];
      if (!node) return undefined;
      if (node.type !== "place") return node as LineTarget;
      return {
        ...(node as LineTarget),
        seat: seatOf[id],
        owners: ownersOf[id] ?? [],
      };
    },
  };

  const shownOnTeaser = (doc: { id: string; revision_id?: unknown }) =>
    writtenByImportOrReviewed(doc, firstRevisions[doc.id]);
  const now = Date.now();
  const searchLines = (node: { id: string; data: Node }, nodeEdges: Edge[]) =>
    storedSearchLines(
      {
        id: node.id,
        revision_id: node.data.revision_id,
        published: node.data.published,
        deleted: node.data.deleted,
      },
      nodeEdges.filter((edge): edge is Edge & { id: string } => !!edge.id),
      lineTargets,
      shownOnTeaser,
      now,
    );

  const resolveParents = (
    target: string,
    visited = new Set<string>(),
  ): string[] => {
    if (visited.has(target)) return [];
    visited.add(target);
    const parents = placeToParentCompanies[target] || [];
    const allParents = [...parents];
    for (const p of parents) {
      allParents.push(...resolveParents(p, visited));
    }
    return allParents;
  };

  const resolvedPlaceToParentCompanies: Record<string, string[]> = {};
  for (const target of Object.keys(placeToParentCompanies)) {
    resolvedPlaceToParentCompanies[target] = resolveParents(target);
  }

  const targetCounts: Record<string, Set<string>> = {};
  for (const edge of edges as Edge[]) {
    if (!edge.target || !edge.source) continue;
    // We only care about public edges
    if (!pageIsPublic(edge)) continue;

    // We only care about public people
    const person = peopleMap[edge.source];
    if (!person || !pageIsPublic(person)) continue;

    const targets = [edge.target];
    if (placeToRegions[edge.target]) {
      targets.push(...placeToRegions[edge.target]!);
    }
    if (resolvedPlaceToParentCompanies[edge.target]) {
      targets.push(...resolvedPlaceToParentCompanies[edge.target]!);
    }

    for (const target of targets) {
      if (!targetCounts[target]) {
        targetCounts[target] = new Set();
      }
      targetCounts[target]!.add(edge.source);
    }
  }

  // Throttled as Firestore asks, 500 writes a second to start with: the
  // updates go in id order, so each stretch of them lands on one key range.
  const writer = db.bulkWriter();
  let failed = 0;
  let firstFailure: unknown;
  let writes: Promise<void>[] = [];
  // The rows /api/stats/regions serves, taken from the same stats being
  // written to the region nodes rather than recomputed, so the two cannot
  // disagree. See server/utils/regionStats.ts.
  const regionRows: RegionStat[] = [];

  for (const node of nodes) {
    const nodeEdges = edgesByNode[node.id] || [];
    const nodeNotes = notesByNode[node.id] || [];
    const nodeVotes = votesByNode[node.id] || [];

    const updateData = buildNodeUpdateData(
      node,
      nodeEdges,
      nodeNotes,
      nodeVotes,
      revisionsByNode[node.id] || [],
      placeToRegions,
      resolvedPlaceToParentCompanies,
      nodeGroupSizeMap,
      targetCounts,
      publicPlaceIds,
      unpaidSeats,
      factsByNode[node.id] ?? 0,
      factTypesByNode[node.id] ?? noFactTypes,
      searchLines,
    );

    if (node.data.type === "region") {
      const region = node.data as Region;
      regionRows.push(
        regionStat(
          node.id,
          { ...region, stats: updateData.stats },
          isPowiat(region)
            ? partyCounts(targetCounts[node.id] ?? [], peopleMap)
            : undefined,
        ),
      );
    }

    writes.push(
      writer.update(db.collection("nodes").doc(node.id), updateData).then(
        () => undefined,
        (error: unknown) => {
          failed++;
          firstFailure ??= error;
        },
      ),
    );
    if (writes.length === FLUSH_EVERY) {
      await Promise.all([writer.flush(), ...writes]);
      writes = [];
    }
  }

  await Promise.all([writer.close(), ...writes]);
  if (failed > 0) {
    throw createError({
      statusCode: 500,
      message: `${failed} of ${nodes.length} nodes were not updated: ${String(firstFailure)}`,
    });
  }
  await writeRegionStats(db, regionRows, new Date());
  // The cached handlers and the cached home page serve what this just
  // rewrote; the home map kept its counts from before the recount for hours.
  await dropCachedResponses("nitro:handlers", "nitro:routes");

  return {
    status: "success",
    computedNodes: nodes.length,
    computedRegions: regionRows.length,
  };
});

/**
 * Extract from an array and aggregate by the given extractor.
 * @param collection Collection to be aggregated
 * @param extractor Extractor from a document to an id
 * @returns Aggregated by extractor.
 */
const extractByNode = function <T>(
  collection: T[],
  extractor: (item: T) => string[],
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const doc of collection) {
    // TODO - do we need some validation here?
    // Maybe typing that a given collection has a given type?
    const item = doc;
    const keys = extractor(item);
    for (const key of keys) {
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
  }
  return result;
};

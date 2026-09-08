import { getFirestore } from "firebase-admin/firestore";
import { requireAdmin } from "~~/server/utils/auth";
import type {
  Edge,
  Note,
  VoteDocument,
  Person,
  Company,
  Region,
  Node,
  Revision,
} from "~~/shared/model";
import {
  computeRevisionsObj,
  normalizeUpdateTime,
  type RevisionMinimal,
} from "~~/shared/revisions";
import { computeNodeStats } from "~~/shared/stats";
import { pageIsPublic } from "~~/shared/model";
import { bodyIsPaidPost } from "~~/shared/companyBodies";
import { getEdges, getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";
import {
  regionStat,
  writeRegionStats,
  type RegionStat,
} from "~~/server/utils/regionStats";

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
  nodeRevisionsRaw: { id: string; data: Revision }[],
  placeToRegions: Record<string, string[]>,
  resolvedPlaceToParentCompanies: Record<string, string[]>,
  nodeGroupSizeMap: Record<string, number>,
  targetCounts: Record<string, Set<string>>,
  publicPlaceIds: ReadonlySet<string>,
  unpaidSeatPlaceIds: ReadonlySet<string>,
  nodeFactsCount: number,
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
    unpaidSeatPlaceIds,
    nodeFactsCount,
  );

  stats.nodeGroupSize = nodeGroupSizeMap[node.id] || 0;
  if (node.data.type === "region") {
    stats.people = targetCounts[node.id]?.size || 0;
  }

  const mappedRevisions: RevisionMinimal[] = nodeRevisionsRaw.map((r) => {
    return {
      id: r.id,
      update_time: normalizeUpdateTime(r.data.update_time),
    };
  });
  const revisionsObj = computeRevisionsObj(
    node.data.revision_id,
    mappedRevisions,
  );

  return {
    stats,
    revisions: revisionsObj,
  };
}

export default defineEventHandler(async (event) => {
  // Reads every node, edge, note, vote and revision and writes back to every
  // node, so an open one is both a way to run up the bill and a way to
  // overwrite the counters the whole site is filtered and ordered by. Admin
  // rather than merely signed in, for the same reason approving a revision is:
  // this decides what the public sees.
  await requireAdmin(event);

  const db = getFirestore("koryta-pl");

  const [
    nodesSnap,
    edgesSnap,
    notesSnap,
    votesSnap,
    revisionsSnap,
    extractionsSnap,
  ] = await Promise.all([
    db.collection("nodes").get(),
    db.collection("edges").get(),
    db.collection("notes").get(),
    db.collection("votes").get(),
    db.collection("revisions").get(),
    // Only the id of the person each fact was matched to: the justification is
    // a paragraph of prose and there is one per fact, so reading the documents
    // whole would be the largest read in this handler to count them.
    db.collection("extractions").select("personNodeId").get(),
  ]);

  const nodes = nodesSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Node,
  }));
  const edges = edgesSnap.docs.map((doc) => doc.data() as Edge);
  const notes = notesSnap.docs.map((doc) => doc.data() as Note);
  const votes = votesSnap.docs.map((doc) => doc.data() as VoteDocument);
  const revisions = revisionsSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as Revision,
  }));

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
  for (const doc of extractionsSnap.docs) {
    const personNodeId = doc.get("personNodeId") as string | undefined;
    if (personNodeId) {
      factsByNode[personNodeId] = (factsByNode[personNodeId] ?? 0) + 1;
    }
  }

  const revisionsByNode: Record<string, { id: string; data: Revision }[]> = {};
  for (const rev of revisions) {
    const nId = rev.data.node_id || rev.data.nodeId;
    if (nId) {
      if (!revisionsByNode[nId]) revisionsByNode[nId] = [];
      revisionsByNode[nId].push(rev);
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

  // Institutions whose supervisory organ is one nobody is paid to sit on - the
  // SPZOZ hospitals and their rada społeczna. A seat there is dropped from the
  // employment counters the same way a seat at a place nobody could show is
  // publicly owned is. `supervisoryBody` is absent on every other company, so
  // this is 243 of the 4,047 places.
  const unpaidSeatPlaceIds = new Set(
    Object.entries(placesMap)
      .filter(([, place]) => !bodyIsPaidPost(place.supervisoryBody))
      .map(([id]) => id),
  );

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

  const chunks = [];
  let currentBatch = db.batch();
  let operationCount = 0;
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
      unpaidSeatPlaceIds,
      factsByNode[node.id] ?? 0,
    );

    if (node.data.type === "region") {
      regionRows.push(
        regionStat(node.id, {
          ...(node.data as Region),
          stats: updateData.stats,
        }),
      );
    }

    const nodeRef = db.collection("nodes").doc(node.id);
    currentBatch.update(nodeRef, updateData);
    operationCount++;

    if (operationCount === 400) {
      chunks.push(currentBatch.commit());
      currentBatch = db.batch();
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    chunks.push(currentBatch.commit());
  }

  await Promise.all(chunks);
  await writeRegionStats(db, regionRows, new Date());

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

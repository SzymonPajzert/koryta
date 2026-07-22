import { getFirestore } from "firebase-admin/firestore";
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
import { getEdges, getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";

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
    transitiveTargets,
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

export default defineEventHandler(async () => {
  // TODO enable check here
  // await getUser(event);

  const db = getFirestore("koryta-pl");

  const [nodesSnap, edgesSnap, notesSnap, votesSnap, revisionsSnap] =
    await Promise.all([
      db.collection("nodes").get(),
      db.collection("edges").get(),
      db.collection("notes").get(),
      db.collection("votes").get(),
      db.collection("revisions").get(),
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
    (vote) => [vote.nodeId],
  );

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
    if (edge.type === "owns" && edge.source && edge.target) {
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
    );

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

  return { status: "success", computedNodes: nodes.length };
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

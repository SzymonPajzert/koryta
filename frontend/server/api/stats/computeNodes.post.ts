import { getFirestore } from "firebase-admin/firestore";
import type {
  Edge,
  Note,
  VoteDocument,
  Person,
  Company,
  Region,
} from "~~/shared/model";
import { computeNodeStats } from "~~/shared/stats";
import { getEdges, getNodesNoStats, getNodeGroups } from "~~/shared/graph/util";
import { partyColors } from "~~/shared/misc";

export default defineEventHandler(async () => {
  // TODO enable check here
  // await getUser(event);

  const db = getFirestore("koryta-pl");

  const [nodesSnap, edgesSnap, notesSnap, votesSnap] = await Promise.all([
    db.collection("nodes").get(),
    db.collection("edges").get(),
    db.collection("notes").get(),
    db.collection("votes").get(),
  ]);

  const nodes = nodesSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const edges = edgesSnap.docs.map((doc) => doc.data());
  const notes = notesSnap.docs.map((doc) => doc.data());
  const votes = votesSnap.docs.map((doc) => doc.data());

  const nodesRecord: Record<string, FirebaseFirestore.DocumentData> = {};
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

  const chunks = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const node of nodes) {
    const nodeEdges = edgesByNode[node.id] || [];
    const nodeNotes = notesByNode[node.id] || [];
    const nodeVotes = votesByNode[node.id] || [];

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

    const stats = computeNodeStats(
      !!node.data.revision_id,
      nodeEdges,
      nodeNotes,
      nodeVotes,
      transitiveTargets,
    );
    stats.nodeGroupSize = nodeGroupSizeMap[node.id] || 0;

    const nodeRef = db.collection("nodes").doc(node.id);
    currentBatch.update(nodeRef, { stats });
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
  collection: FirebaseFirestore.DocumentData[],
  extractor: (item: T) => string[],
): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const doc of collection) {
    // TODO - do we need some validation here?
    // Maybe typing that a given collection has a given type?
    const item = doc as T;
    const keys = extractor(item);
    for (const key of keys) {
      if (!result[key]) result[key] = [];
      result[key].push(item);
    }
  }
  return result;
};

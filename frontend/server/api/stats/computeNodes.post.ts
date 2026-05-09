import { getFirestore } from "firebase-admin/firestore";
import type { Edge, Note, VoteDocument } from "~~/shared/model";
import { computeNodeStats } from "~~/shared/stats";

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
    ...extractByNode(edges, (edge) => [edge.source, edge.target]),
  };

  const notesByNode = extractByNode<Note>(notes, (note) => [note.nodeId]);
  const votesByNode = extractByNode<VoteDocument>(votes, (vote) => [
    vote.nodeId,
  ]);

  const chunks = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const node of nodes) {
    const nodeEdges = edgesByNode[node.id] || [];
    const nodeNotes = notesByNode[node.id] || [];
    const nodeVotes = votesByNode[node.id] || [];

    const stats = computeNodeStats(
      !!node.data.revision_id,
      nodeEdges,
      nodeNotes,
      nodeVotes,
    );

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

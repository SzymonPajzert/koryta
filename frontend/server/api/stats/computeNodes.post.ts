import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getUser } from "~~/server/utils/auth";
import type { NodeStats } from "~~/shared/model";

function calculateExperience(edges: FirebaseFirestore.DocumentData[]): number {
  let experienceMonths = 0;
  for (const edge of edges) {
    if (edge.type === "employed") {
      const startStr =
        edge.start_date && typeof edge.start_date === "string"
          ? edge.start_date.split("T")[0]
          : null;
      const endStr =
        edge.end_date && typeof edge.end_date === "string"
          ? edge.end_date.split("T")[0]
          : null;

      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : new Date();

      if (start && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const diffMs = end.getTime() - start.getTime();
        experienceMonths += diffMs / (1000 * 60 * 60 * 24 * 30.44);
      }
    }
  }
  return Math.floor((experienceMonths / 12) * 10) / 10;
}

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

  const nodesRecord: Record<string, any> = {};
  for (const n of nodes) {
    nodesRecord[n.id] = n.data;
  }

  // Group data by nodeId
  const edgesByNode: Record<string, any[]> = {};
  for (const edge of edges) {
    if (!edge.source) continue;
    if (!edgesByNode[edge.source]) edgesByNode[edge.source] = [];
    edgesByNode[edge.source].push(edge);
  }

  const notesByNode: Record<string, any[]> = {};
  for (const note of notes) {
    if (!note.nodeId) continue;
    if (!notesByNode[note.nodeId]) notesByNode[note.nodeId] = [];
    notesByNode[note.nodeId].push(note);
  }

  const votesByNode: Record<string, any[]> = {};
  for (const vote of votes) {
    if (!vote.nodeId) continue;
    if (!votesByNode[vote.nodeId]) votesByNode[vote.nodeId] = [];
    votesByNode[vote.nodeId].push(vote);
  }

  const chunks = [];
  let currentBatch = db.batch();
  let operationCount = 0;

  for (const node of nodes) {
    const nodeEdges = edgesByNode[node.id] || [];
    const nodeNotes = notesByNode[node.id] || [];
    const nodeVotes = votesByNode[node.id] || [];

    const approvedEdges = nodeEdges.filter((e) => !!e.revision_id);

    const aggregatedVotes: Record<string, number> = {};
    for (const v of nodeVotes) {
      if (v.categoryVotes) {
        for (const [category, value] of Object.entries(v.categoryVotes)) {
          aggregatedVotes[category] =
            (aggregatedVotes[category] || 0) + (value as number);
        }
      }
    }

    const allTargetNodeIds = [
      ...new Set(nodeEdges.map((e) => e.target)),
    ].filter(Boolean);
    const approvedTargetNodeIds = [
      ...new Set(approvedEdges.map((e) => e.target)),
    ].filter(Boolean);

    const allElectionTargetIds = [
      ...new Set(
        nodeEdges.filter((e) => e.type === "election").map((e) => e.target),
      ),
    ].filter(Boolean);
    const approvedElectionTargetIds = [
      ...new Set(
        approvedEdges.filter((e) => e.type === "election").map((e) => e.target),
      ),
    ].filter(Boolean);

    const allElectionLocations = [
      ...new Set(
        allElectionTargetIds.map((id) => nodesRecord[id]?.name).filter(Boolean),
      ),
    ];
    const approvedElectionLocations = [
      ...new Set(
        approvedElectionTargetIds
          .map((id) => nodesRecord[id]?.name)
          .filter(Boolean),
      ),
    ];

    const stats: NodeStats = {
      isApproved: !!node.data.revision_id,
      notesCount: nodeNotes.length,
      votes: aggregatedVotes,
      edges: {
        all: {
          experienceMonths: calculateExperience(nodeEdges),
          targetNodeIds: allTargetNodeIds,
          electionLocations: allElectionLocations,
        },
        approved: {
          experienceMonths: calculateExperience(approvedEdges),
          targetNodeIds: approvedTargetNodeIds,
          electionLocations: approvedElectionLocations,
        },
      },
    };

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

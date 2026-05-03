import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

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

export const onEdgeWritten = onDocumentWritten(
  {
    document: "edges/{edgeId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.exists ? before.data() : null;
    const afterData = after?.exists ? after.data() : null;

    const sourceId = afterData?.source || beforeData?.source;

    if (!sourceId) {
      logger.warn(`Could not determine source nodeId for edge doc: ${event.params.edgeId}`);
      return;
    }

    const db = getFirestore("koryta-pl");
    
    try {
      // Fetch all edges for the source node to accurately recalculate the metrics
      const edgesSnapshot = await db.collection("edges").where("source", "==", sourceId).get();
      const allEdges = edgesSnapshot.docs.map(doc => doc.data());
      
      const approvedEdges = allEdges.filter(edge => !!edge.revision_id);

      const allExperience = calculateExperience(allEdges);
      const approvedExperience = calculateExperience(approvedEdges);

      const allTargetNodeIds = [...new Set(allEdges.map(e => e.target))].filter(Boolean);
      const approvedTargetNodeIds = [...new Set(approvedEdges.map(e => e.target))].filter(Boolean);

      const allElectionTargetIds = [...new Set(allEdges.filter(e => e.type === "election").map(e => e.target))].filter(Boolean);
      const approvedElectionTargetIds = [...new Set(approvedEdges.filter(e => e.type === "election").map(e => e.target))].filter(Boolean);

      const nodeCache: Record<string, string> = {};

      const fetchNodeNames = async (ids: string[]) => {
        const toFetch = ids.filter(id => !nodeCache[id]);
        if (toFetch.length === 0) return;
        const chunks = [];
        for (let i = 0; i < toFetch.length; i += 100) {
          chunks.push(toFetch.slice(i, i + 100));
        }
        for (const chunk of chunks) {
          const refs = chunk.map(id => db.collection("nodes").doc(id));
          const snapshots = await db.getAll(...refs);
          for (const snap of snapshots) {
            if (snap.exists) {
               nodeCache[snap.id] = snap.data()?.name || "";
            }
          }
        }
      };

      await fetchNodeNames(allElectionTargetIds);

      const allElectionLocations = [...new Set(allElectionTargetIds.map(id => nodeCache[id]).filter(Boolean))];
      const approvedElectionLocations = [...new Set(approvedElectionTargetIds.map(id => nodeCache[id]).filter(Boolean))];

      const nodeRef = db.collection("nodes").doc(sourceId);
      await nodeRef.update({
        "stats.edges.all.experienceMonths": allExperience,
        "stats.edges.all.targetNodeIds": allTargetNodeIds,
        "stats.edges.all.electionLocations": allElectionLocations,
        "stats.edges.approved.experienceMonths": approvedExperience,
        "stats.edges.approved.targetNodeIds": approvedTargetNodeIds,
        "stats.edges.approved.electionLocations": approvedElectionLocations,
      });

      logger.info(`Successfully recalculated edge stats for node: ${sourceId}`);
    } catch (error) {
      logger.error(`Error recalculating edge stats for node: ${sourceId}`, error);
    }
  }
);

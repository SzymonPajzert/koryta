import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { computeEdgeStats } from "./stats";
import type { Edge } from "./model";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
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
      logger.warn(
        `Could not determine source nodeId for edge doc: ${event.params.edgeId}`,
      );
      return;
    }

    const db = getFirestore("koryta-pl");

    try {
      // Fetch all edges for the source node to accurately recalculate the metrics
      const edgesSnapshot = await db
        .collection("edges")
        .where("source", "==", sourceId)
        .get();
      const allEdges = edgesSnapshot.docs.map((doc) => doc.data() as Edge);

      const targetIds = [
        ...new Set(allEdges.map((e) => e.target).filter(Boolean)),
      ] as string[];
      const transitiveTargets: Record<string, string[]> = {};

      if (targetIds.length > 0) {
        // Chunk targetIds into groups of 30 for the 'in' query
        for (let i = 0; i < targetIds.length; i += 30) {
          const chunk = targetIds.slice(i, i + 30);
          const ownsEdgesSnapshot = await db
            .collection("edges")
            .where("target", "in", chunk)
            .where("type", "==", "owns")
            .get();

          for (const doc of ownsEdgesSnapshot.docs) {
            const edge = doc.data() as Edge;
            if (edge.source && edge.target) {
              if (!transitiveTargets[edge.target]) {
                transitiveTargets[edge.target] = [];
              }
              // Ideally we would verify edge.source is a region here.
              // Assuming all 'owns' edges targeting a company are from regions/parent companies.
              // For now, any 'owns' source will be included.
              transitiveTargets[edge.target].push(edge.source);
            }
          }
        }
      }

      const edgeStats = computeEdgeStats(allEdges, transitiveTargets);

      const nodeRef = db.collection("nodes").doc(sourceId);
      await nodeRef.update({
        "stats.edges": edgeStats,
      });

      logger.info(`Successfully recalculated edge stats for node: ${sourceId}`);
    } catch (error) {
      logger.error(
        `Error recalculating edge stats for node: ${sourceId}`,
        error,
      );
    }
  },
);

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

import { computeEdgeStats } from "./stats";
import type { Edge } from "./model";

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

      const edgeStats = computeEdgeStats(allEdges);

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

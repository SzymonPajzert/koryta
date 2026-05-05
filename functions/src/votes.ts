import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { computeVoteStats } from "./stats";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

export const onVoteWritten = onDocumentWritten(
  {
    document: "votes/{voteId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.exists ? before.data() : null;
    const afterData = after?.exists ? after.data() : null;

    // Use nodeId from the document or try extracting from the document ID pattern: [nodeId]_[userId]
    let nodeId = afterData?.nodeId || beforeData?.nodeId;

    if (!nodeId) {
      const voteId = event.params.voteId;
      const parts = voteId.split("_");
      if (parts.length >= 2) {
        // Assume the last part is userId and the rest is nodeId
        nodeId = parts.slice(0, -1).join("_");
      }
    }

    if (!nodeId) {
      logger.warn(
        `Could not determine nodeId for vote doc: ${event.params.voteId}`,
      );
      return;
    }

    const db = getFirestore("koryta-pl");

    try {
      const votesSnapshot = await db
        .collection("votes")
        .where("nodeId", "==", nodeId)
        .get();
      const allVotes = votesSnapshot.docs.map((doc) => doc.data());

      const voteStats = computeVoteStats(allVotes);

      const nodeRef = db.collection("nodes").doc(nodeId);
      await nodeRef.update({
        "stats.votes": voteStats,
      });

      logger.info(
        `Successfully recalculated aggregatedVotes for node: ${nodeId}`,
      );
    } catch (error) {
      logger.error(
        `Error recalculating aggregatedVotes for node: ${nodeId}`,
        error,
      );
    }
  },
);

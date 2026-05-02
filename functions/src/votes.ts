import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

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
      logger.warn(`Could not determine nodeId for vote doc: ${event.params.voteId}`);
      return;
    }

    const beforeVotes = beforeData?.categoryVotes || {};
    const afterVotes = afterData?.categoryVotes || {};

    const updatePayload: Record<string, any> = {};

    // Get a unique set of all categories impacted (voted before or voted after)
    const allCategories = new Set([
      ...Object.keys(beforeVotes),
      ...Object.keys(afterVotes),
    ]);

    for (const category of allCategories) {
      const oldVal = typeof beforeVotes[category] === "number" ? beforeVotes[category] : 0;
      const newVal = typeof afterVotes[category] === "number" ? afterVotes[category] : 0;

      const delta = newVal - oldVal;

      if (delta !== 0) {
        updatePayload[`stats.votes.${category}`] = FieldValue.increment(delta);
      }
    }

    // Only commit an update if there's an actual change in the votes
    if (Object.keys(updatePayload).length > 0) {
      const db = getFirestore("koryta-pl");
      const nodeRef = db.collection("nodes").doc(nodeId);

      try {
        await nodeRef.update(updatePayload);
        logger.info(`Successfully updated aggregatedVotes for node: ${nodeId}`, updatePayload);
      } catch (error) {
        logger.error(`Error updating aggregatedVotes for node: ${nodeId}`, error);
        // Note: FieldValue.increment on update() throws if the document does not exist.
        // Assuming node document is always created prior to someone voting.
      }
    }
  }
);

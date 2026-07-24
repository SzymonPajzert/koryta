import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { computeVoteStats } from "./stats";
import type { VoteDocument } from "./model";

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
    const data = event.data?.after?.exists
      ? event.data.after.data()
      : event.data?.before?.exists
        ? event.data.before.data()
        : null;

    if (!data) return;
    const target = data.extractionId
      ? {
          collection: "extractions",
          field: "extractionId",
          id: data.extractionId,
        }
      : data.nodeId
        ? { collection: "nodes", field: "nodeId", id: data.nodeId }
        : null;

    if (!target) {
      logger.warn(
        `Vote ${event.params.voteId} sets neither nodeId nor extractionId; skipping aggregation`,
      );
      return;
    }

    const db = getFirestore("koryta-pl");

    try {
      const votesSnapshot = await db
        .collection("votes")
        .where(target.field, "==", target.id)
        .get();
      const allVotes = votesSnapshot.docs.map(
        (doc) => doc.data() as VoteDocument,
      );

      const voteStats = computeVoteStats(allVotes);

      await db
        .collection(target.collection)
        .doc(target.id)
        .update({ "stats.votes": voteStats });

      logger.info(
        `Recalculated stats.votes for ${target.collection}/${target.id}`,
      );
    } catch (error) {
      logger.error(
        `Error recalculating stats.votes for ${target.collection}/${target.id}`,
        error,
      );
    }
  },
);

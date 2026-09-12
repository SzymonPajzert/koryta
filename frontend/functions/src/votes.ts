import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { computeBadgeStats, computeVoteStats } from "./stats";
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
    const data = event.data?.after.exists
      ? event.data.after.data()
      : event.data?.before.exists
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

      // One `update` for both aggregates rather than two writes: they are
      // derived from the same read of the same collection, and splitting them
      // would double the write cost of every vote and leave a window in which
      // the node disagrees with itself.
      //
      // `stats.badges` is written unconditionally, including as an empty map.
      // It is tempting to skip the field when nobody has voted a badge, but
      // that is exactly the case that has to be written: when the last voter
      // withdraws, the recomputed tally is `{}`, and omitting it would leave
      // the old counter standing on the node - a chip the votes no longer
      // support, visible to everybody, that no further vote would ever clear.
      //
      // Nodes only. Badges are a claim about a person, and `extractions` are
      // sentences pulled out of articles; writing the field there would put a
      // key on documents nothing reads it from. A dotted path replaces just
      // that field, so `stats.votes` and the rest of `stats` are untouched
      // either way.
      const update: Record<string, unknown> = { "stats.votes": voteStats };
      if (target.collection === "nodes") {
        update["stats.badges"] = computeBadgeStats(allVotes);
      }

      await db.collection(target.collection).doc(target.id).update(update);

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

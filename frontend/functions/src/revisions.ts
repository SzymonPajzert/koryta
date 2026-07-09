import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import {
  computeRevisionsObj,
  type RevisionMinimal,
} from "../../shared/revisions";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

export const onRevisionWritten = onDocumentWritten(
  {
    document: "revisions/{revisionId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    let nodeId: string | undefined;
    try {
      const snap = event.data;
      if (!snap) {
        logger.info("No data associated with the event");
        return;
      }

      // If both before and after exist, it's an update.
      // If after does not exist, it's a delete.
      // If before does not exist, it's a create.
      const data = snap.after.exists ? snap.after.data() : snap.before.data();
      if (!data) return;

      nodeId = data.node_id || data.nodeId;
      if (!nodeId) {
        logger.error("No nodeId found in revision data");
        return;
      }

      const revisionsArray = await revisionsForNode(nodeId);
      // Fail gracefully if there are no revisions for this node
      if (revisionsArray.length === 0) {
        logger.error(
          "No revisions found for node:",
          nodeId,
          "revision: ",
          data.id,
        );
        const nodeRef = db.collection("nodes").doc(nodeId);
        await nodeRef.update({
          revisions: null,
        });
        return;
      }

      const nodeDoc = await db.collection("nodes").doc(nodeId).get();
      if (!nodeDoc.exists) {
        logger.error("Node document does not exist for nodeId:", nodeId);
        return;
      }

      const nodeData = nodeDoc.data();
      const nodeRevisionId = nodeData?.revision_id;
      const computedRevisions = computeRevisionsObj(
        nodeRevisionId,
        revisionsArray,
      );

      const nodeRef = db.collection("nodes").doc(nodeId);

      if (computedRevisions) {
        await nodeRef.update({ revisions: computedRevisions });
      } else {
        logger.error(
          "Failed to compute revisions for node:",
          nodeId,
          "revision: ",
          data.id,
        );
        await nodeRef.update({ revisions: null });
      }

      logger.info(
        `Successfully recalculated revisions for node: ${nodeId} (total: ${revisionsArray.length})`,
      );
    } catch (error) {
      logger.error(`Error recalculating revisions for node: ${nodeId}`, error);
    }
  },
);

async function revisionsForNode(nodeId: string): Promise<RevisionMinimal[]> {
  // Query all revisions for this node
  // TODO - resolve node_id and nodeId inconsistency
  const allDocsUnderscore = await db
    .collection("revisions")
    .where("node_id", "==", nodeId)
    .get();
  const allDocsCapitalized = await db
    .collection("revisions")
    .where("nodeId", "==", nodeId)
    .get();

  const allDocs = [...allDocsUnderscore.docs, ...allDocsCapitalized.docs];

  const revisionsArray: RevisionMinimal[] = allDocs.map((d) => ({
    id: d.id,
    update_time: d.data().update_time as string | null,
  }));
  return revisionsArray;
}

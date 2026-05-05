import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

// Ensure the Firebase Admin SDK is initialized
if (getApps().length === 0) {
  initializeApp();
}

export const onNoteWritten = onDocumentWritten(
  {
    document: "notes/{noteId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.exists ? before.data() : null;
    const afterData = after?.exists ? after.data() : null;

    const nodeId = afterData?.nodeId || beforeData?.nodeId;

    if (!nodeId) {
      logger.warn(
        `Could not determine nodeId for note doc: ${event.params.noteId}`,
      );
      return;
    }

    const db = getFirestore("koryta-pl");

    try {
      const notesSnapshot = await db
        .collection("notes")
        .where("nodeId", "==", nodeId)
        .get();
      const notesCount = notesSnapshot.size;

      const nodeRef = db.collection("nodes").doc(nodeId);
      await nodeRef.update({
        "stats.notesCount": notesCount,
      });

      logger.info(
        `Successfully recalculated notesCount to ${notesCount} for node: ${nodeId}`,
      );
    } catch (error) {
      logger.error(`Error recalculating notesCount for node: ${nodeId}`, error);
    }
  },
);

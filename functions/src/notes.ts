import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
      logger.warn(`Could not determine nodeId for note doc: ${event.params.noteId}`);
      return;
    }

    let delta = 0;
    if (!beforeData && afterData) {
      // Note created
      delta = 1;
    } else if (beforeData && !afterData) {
      // Note deleted
      delta = -1;
    }

    if (delta !== 0) {
      const db = getFirestore("koryta-pl");
      const nodeRef = db.collection("nodes").doc(nodeId);

      try {
        await nodeRef.update({
          "stats.notesCount": FieldValue.increment(delta),
        });
        logger.info(`Successfully updated notesCount by ${delta} for node: ${nodeId}`);
      } catch (error) {
        logger.error(`Error updating notesCount for node: ${nodeId}`, error);
      }
    }
  }
);

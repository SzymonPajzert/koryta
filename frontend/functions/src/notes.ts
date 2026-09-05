import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { isPipelineUid } from "./stats";

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

      // Split by who wrote it, because the two counts answer different
      // questions and only one of them is about people.
      //
      // `notesCount` is read as "somebody has looked at this page": it is what
      // /api/stats/progress counts under „reviewed", what takes a person out
      // of the „nikt tego nie sprawdził" queue, and what the table sorts on
      // under „Liczba notatek". A pipeline note is not somebody looking - it
      // is a paragraph copied off Wikipedia - and counting one would mark
      // every person with a Wikipedia article as reviewed without anybody
      // having read a word.
      //
      // The pipeline's own notes are still counted, separately, so a page that
      // has one is not indistinguishable from a page that has nothing.
      const notesCount = notesSnapshot.docs.filter(
        (doc) => !isPipelineUid(doc.data().userUid),
      ).length;
      const pipelineNotesCount = notesSnapshot.size - notesCount;

      const nodeRef = db.collection("nodes").doc(nodeId);
      await nodeRef.update({
        "stats.notesCount": notesCount,
        "stats.pipelineNotesCount": pipelineNotesCount,
      });

      logger.info(
        `Successfully recalculated notesCount to ${notesCount} ` +
          `(${pipelineNotesCount} from pipelines) for node: ${nodeId}`,
      );
    } catch (error) {
      logger.error(`Error recalculating notesCount for node: ${nodeId}`, error);
    }
  },
);

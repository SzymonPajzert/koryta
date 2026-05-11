import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

export const onNodeWritten = onDocumentWritten(
  {
    document: "nodes/{nodeId}",
    database: "koryta-pl",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    const beforeData = before?.exists ? before.data() : null;
    const afterData = after?.exists ? after.data() : null;

    if (!afterData) return; // Node deleted

    const beforeRev = !!beforeData?.revision_id;
    const afterRev = !!afterData?.revision_id;

    if (beforeRev !== afterRev) {
      // Avoid infinite loops by only updating if stats.isApproved doesn't match
      const currentStatsApproved = afterData?.stats?.isApproved;
      if (currentStatsApproved !== afterRev) {
        try {
          await event.data?.after?.ref?.update({
            "stats.isApproved": afterRev,
          });
          logger.info(
            `Updated stats.isApproved to ${afterRev} for node: ${event.params.nodeId}`,
          );
        } catch (error) {
          logger.error(
            `Failed to update stats.isApproved for node: ${event.params.nodeId}`,
            error,
          );
        }
      }
    }
  },
);

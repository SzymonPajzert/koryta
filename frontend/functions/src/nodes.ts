import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { pageIsPublic } from "../../shared/model";
import { nameChunksToWrite } from "../../shared/search";

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

    const beforePublic = beforeData ? pageIsPublic(beforeData) : false;
    const afterPublic = pageIsPublic(afterData);

    const updatePayload: Record<string, unknown> = {};

    if (beforePublic !== afterPublic) {
      // Avoid infinite loops by only updating if stats.isApproved doesn't match
      const currentStatsApproved = afterData.stats?.isApproved;
      if (currentStatsApproved !== afterPublic) {
        updatePayload["stats.isApproved"] = afterPublic;
      }
    }

    // On every write that finds the index out of date, not only on a rename,
    // so a change to how it is cut reaches each page the next time anything
    // writes it. Its own write reads back as up to date, which ends the loop.
    const isTargetType = ["place", "region", "person"].includes(afterData.type);
    if (isTargetType && typeof afterData.name === "string" && afterData.name) {
      const nameChunksLower = nameChunksToWrite(
        afterData.name,
        afterData.nameChunksLower,
      );
      if (nameChunksLower) updatePayload["nameChunksLower"] = nameChunksLower;
    }

    if (Object.keys(updatePayload).length > 0) {
      try {
        if (!event.data) {
          return;
        }
        await event.data.after.ref.update(updatePayload);
        logger.info(
          `Updated fields ${Object.keys(updatePayload).join(", ")} for node: ${event.params.nodeId}`,
        );
      } catch (error) {
        logger.error(
          `Failed to update fields for node: ${event.params.nodeId}`,
          error,
        );
      }
    }
  },
);

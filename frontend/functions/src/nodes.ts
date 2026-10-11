import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { pageIsPublic } from "../../shared/model";
import { generateChunksLower } from "../../shared/search";

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

    // Not for a page merged away: it goes off the site in the same write that
    // takes its stats off (server/utils/merge.ts), and an `isApproved: false`
    // put back here would return it to every queue of unpublished people.
    if (beforePublic !== afterPublic && afterData.deleted !== true) {
      // Avoid infinite loops by only updating if stats.isApproved doesn't match
      const currentStatsApproved = afterData.stats?.isApproved;
      if (currentStatsApproved !== afterPublic) {
        updatePayload["stats.isApproved"] = afterPublic;
      }
    }

    const isTargetType = ["place", "region", "person"].includes(afterData.type);
    if (isTargetType && afterData.name) {
      const beforeName = beforeData?.name;
      const afterName = afterData.name;
      const missingChunks =
        !afterData.nameChunksLower || !Array.isArray(afterData.nameChunksLower);

      if (beforeName !== afterName || missingChunks) {
        const nameChunksLower = generateChunksLower(afterName);

        // Also avoid infinite loops for chunks
        if (
          JSON.stringify(afterData.nameChunksLower) !==
          JSON.stringify(nameChunksLower)
        ) {
          updatePayload["nameChunksLower"] = nameChunksLower;
        }
      }
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

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

const generateChunksLower = (name: string): string[] => {
  const chunks: string[] = [""];
  const lowerName = name.toLowerCase();

  for (let i = 1; i <= lowerName.length; i++) {
    chunks.push(lowerName.substring(0, i));
  }

  const words = lowerName.split(" ");
  if (words.length > 1) {
    for (const word of words) {
      if (word.length > 0) {
        for (let i = 1; i <= word.length; i++) {
          chunks.push(word.substring(0, i));
        }
      }
    }
  }

  return Array.from(new Set(chunks));
};

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
    const afterRev = !!afterData.revision_id;

    const updatePayload: Record<string, unknown> = {};

    if (beforeRev !== afterRev) {
      // Avoid infinite loops by only updating if stats.isApproved doesn't match
      const currentStatsApproved = afterData.stats?.isApproved;
      if (currentStatsApproved !== afterRev) {
        updatePayload["stats.isApproved"] = afterRev;
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

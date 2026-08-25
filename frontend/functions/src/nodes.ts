import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { pageIsPublic } from "../../shared/model";
import { generateChunksLower } from "../../shared/search";
import { normalizePersonName } from "../../shared/names";

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

    // People only. `normalizePersonName` folds case, diacritics and hyphens,
    // which is what two spellings of one person share - a company's name is
    // matched on its KRS number instead, and giving one this field would only
    // make the ingest's lookup ambiguous about what it had found.
    //
    // Firestore cannot call a function on its side, so the ingest's "do we
    // already have this person" query has to compare a stored field. That is
    // the whole reason this is written here: see `lookupPersonDoc` in
    // `server/api/ingest/person.post.ts`.
    if (afterData.type === "person" && typeof afterData.name === "string") {
      const nameNormalized = normalizePersonName(afterData.name);
      if (nameNormalized && afterData.nameNormalized !== nameNormalized) {
        updatePayload["nameNormalized"] = nameNormalized;
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

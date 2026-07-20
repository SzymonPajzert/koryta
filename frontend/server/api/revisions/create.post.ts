import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { sanitizeFirestoreData } from "~~/server/utils/revisions";

/** Fields that are internal/computed and should not be copied into revision data */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "nameChunksLower", // used for search indexing
]);

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.node_id) {
    throw createError({
      statusCode: 400,
      message: "Missing required node_id",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();
  const { node_id, ...dataFields } = body;

  // Fetch the existing node to use as a base layer so that the revision
  // contains a complete snapshot (type, wikipedia, rejestrIo, etc.)
  const nodeDoc = await db.collection("nodes").doc(node_id).get();
  const baseFields: Record<string, unknown> = {};
  if (nodeDoc.exists) {
    const nodeData = nodeDoc.data() || {};
    for (const [key, value] of Object.entries(nodeData)) {
      if (!INTERNAL_FIELDS.has(key)) {
        baseFields[key] = value;
      }
    }
  }

  // User-submitted fields override the base node fields
  const mergedData = { ...baseFields, ...dataFields };

  const revision = {
    node_id: node_id,
    data: sanitizeFirestoreData(mergedData),
    update_time: timestamp,
    update_user: user.uid,
    update_automatic: false,
    status: "pending",
  };

  await revisionRef.set(revision);

  return { id: revisionRef.id };
});

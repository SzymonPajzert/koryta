import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { sanitizeFirestoreData } from "~~/server/utils/revisions";
import { personEditSchema } from "~~/shared/api";

/** Fields that are internal/computed and should not be copied into revision data */
// TODO remove it and try just using zod for stripping these fields.
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
  const rawBody = await readBody(event);
  const node_id =
    typeof rawBody.node_id === "string" ? rawBody.node_id : undefined;

  // Only person nodes are supported for now. Parsing against the schema also
  // strips any field that isn't an explicitly allowed person field, so a
  // caller can't smuggle in e.g. `revision_id` and have it written straight
  // to the node below.
  const parsed = personEditSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: parsed.error.issues[0]?.message || "Invalid request body",
      data: parsed.error.issues,
    });
  }
  const dataFields = parsed.data;

  // Without a node_id the user proposes a brand new node instead of a change
  // to an existing one.
  const isNewNode = !node_id;

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = isNewNode
    ? db.collection("nodes").doc()
    : db.collection("nodes").doc(node_id);
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();

  // Fetch the existing node to use as a base layer so that the revision
  // contains a complete snapshot (type, wikipedia, rejestrIo, etc.). A brand
  // new node has no prior data, so it just starts out as a person.
  const baseFields: Record<string, unknown> = isNewNode
    ? { type: "person" }
    : {};
  if (!isNewNode) {
    const nodeDoc = await nodeRef.get();
    const nodeData = nodeDoc.exists ? nodeDoc.data() || {} : {};
    for (const [key, value] of Object.entries(nodeData)) {
      if (!INTERNAL_FIELDS.has(key)) {
        baseFields[key] = value;
      }
    }
  }

  // User-submitted fields override the base node fields
  const mergedData = { ...baseFields, ...dataFields };

  const revision = {
    node_id: nodeRef.id,
    data: sanitizeFirestoreData(mergedData),
    update_time: timestamp,
    update_user: user.uid,
    update_automatic: false,
    status: "pending",
  };

  const batch = db.batch();
  batch.set(revisionRef, revision);
  if (isNewNode) {
    // Create the node itself so the proposal gets an id and can be linked to,
    // voted on and edited further. It is written without a `revision_id`, which
    // keeps it unapproved and therefore hidden from logged out users.
    batch.set(nodeRef, revision.data as Record<string, unknown>);
  }
  await batch.commit();

  return { id: revisionRef.id, node_id: nodeRef.id };
});

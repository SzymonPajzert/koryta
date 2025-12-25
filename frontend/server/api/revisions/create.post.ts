import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.node_id || !body.name) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (node_id, name)",
    });
  }

  const content = body.content || "";

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const revisionRef = db.collection("revisions").doc();

  // Create revision document purely linked to the node, without touching the node itself
  const revision = {
    node_id: body.node_id,
    data: {
      name: body.name,
      type: body.type,
      parties: body.parties || [],
      content: content,
      sourceURL: body.sourceURL || "",
      shortName: body.shortName || "",
    },
    update_time: Timestamp.now(),
    update_user: user.uid,
    visibility: "internal",
  };

  const batch = db.batch();
  batch.set(revisionRef, revision);

  // Also update the node's visibility if it's now internal (user created/edited)
  const nodeRef = db.collection("nodes").doc(body.node_id);
  batch.update(nodeRef, { visibility: "internal" });

  await batch.commit();

  return { id: revisionRef.id };
});

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.node_id || !body.name) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (node_id, name)",
    });
  }

  const content = body.content || "";

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const revisionData = {
    name: body.name,
    type: body.type,
    parties: body.parties || [],
    content: content,
    sourceURL: body.sourceURL || "",
    shortName: body.shortName || "",
  };

  const nodeRef = db.collection("nodes").doc(body.node_id);

  const { batch, revisionRef } = createRevisionTransaction(
    db,
    user,
    nodeRef,
    revisionData,
    false
  );

  await batch.commit();

  return { id: revisionRef.id };
});

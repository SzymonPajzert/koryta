import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body || !body.node_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (node_id)",
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
    // Edge specific fields
    text: body.text || "",
  };

  const collection = body.collection || "nodes";
  const nodeRef = db.collection(collection).doc(body.node_id);

  const batch = db.batch();

  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    nodeRef,
    revisionData,
    false,
  );

  await batch.commit();

  return { id: revisionRef.id };
});

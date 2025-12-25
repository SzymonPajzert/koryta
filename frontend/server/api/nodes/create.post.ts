import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.type || !body.name) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields (type, name)",
    });
  }

  const content = body.content || "";

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");

  const batch = db.batch();
  const nodeRef = db.collection("nodes").doc();
  const revisionRef = db.collection("revisions").doc();

  const revisionData = {
    name: body.name,
    type: body.type,
    parties: body.parties || [],
    content: content,
    sourceURL: body.sourceURL || "",
    shortName: body.shortName || "",
  };

  const revision = {
    node_id: nodeRef.id,
    data: revisionData,
    update_time: Timestamp.now(),
    update_user: user.uid,
  };

  const node = {
    ...revisionData,
    update_time: Timestamp.now(),
    update_user: user.uid,
  };

  batch.set(nodeRef, node);
  batch.set(revisionRef, revision);

  await batch.commit();

  return { id: nodeRef.id };
});

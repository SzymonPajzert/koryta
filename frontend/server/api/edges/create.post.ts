import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.type || !body.source || !body.target) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  
  const batch = db.batch();
  const edgeRef = db.collection("edges").doc();
  const revisionRef = db.collection("revisions").doc();

  const revisionData = {
    source: body.source,
    target: body.target,
    type: body.type,
    name: body.name || "",
    text: body.text || "",
  };

  const revision = {
    node_id: edgeRef.id,
    data: revisionData,
    update_time: Timestamp.now(),
    update_user: user.uid,
  };

  const edge = {
    ...revisionData,
    update_time: Timestamp.now(),
    update_user: user.uid,
    visibility: "internal",
  };

  batch.set(edgeRef, edge);
  batch.set(revisionRef, revision);

  await batch.commit();

  return { id: edgeRef.id };
});

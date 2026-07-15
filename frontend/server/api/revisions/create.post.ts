import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { sanitizeFirestoreData } from "~~/server/utils/revisions";

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

  const revision = {
    node_id: node_id,
    data: sanitizeFirestoreData(dataFields),
    update_time: timestamp,
    update_user: user.uid,
    update_automatic: false,
    status: "pending",
  };

  await revisionRef.set(revision);

  return { id: revisionRef.id };
});

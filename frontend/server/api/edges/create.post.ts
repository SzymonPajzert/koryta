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
  const res = await db.collection("edges").add({
    ...body,
    update_time: Timestamp.now(),
    update_user: user.uid,
    visibility: "internal",
  });

  return { id: res.id };
});

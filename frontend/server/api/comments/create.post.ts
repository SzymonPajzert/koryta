import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.node || !body.text) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const res = await db.collection("comments").add({
    node: body.node,
    text: body.text,
    created_at: new Date(),
    user_id: user.uid,
    // optional: user_name if available in token
  });

  return { id: res.id };
});

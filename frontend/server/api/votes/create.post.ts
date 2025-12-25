import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.node || !body.vote_type) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required fields",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");
  // Check if vote already exists? Maybe not for now.
  const res = await db.collection("votes").add({
    node: body.node,
    vote_type: body.vote_type,
    created_at: new Date(),
    user_id: user.uid,
  });

  return { id: res.id };
});

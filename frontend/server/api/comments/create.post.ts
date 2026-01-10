import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const user = await getUser(event);

  if (!body || !body.content) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing content",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");

  const comment = {
    content: body.content,
    authorId: user.uid,
    authorName: user.email || user.uid,
    createdAt: new Date().toISOString(),
    nodeId: body.nodeId || null,
    edgeId: body.edgeId || null,
    parentId: body.parentId || null,
  };

  const docRef = await db.collection("comments").add(comment);

  return { id: docRef.id, ...comment };
});

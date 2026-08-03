import { getUser } from "~~/server/utils/auth";
import { adminFirestore } from "~~/server/utils/firebase";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const user = await getUser(event);

  if (!body || !body.content) {
    throw createError({
      statusCode: 400,
      message: "Missing content",
    });
  }

  const db = adminFirestore();

  const comment = {
    content: body.content,
    authorId: user.uid,
    authorName: user.uid,
    createdAt: new Date().toISOString(),
    isLead: !body.nodeId && !body.edgeId && !body.parentId,
    nodeId: body.nodeId || null,
    edgeId: body.edgeId || null,
    parentId: body.parentId || null,
  };

  const docRef = await db.collection("comments").add(comment);

  return { id: docRef.id, ...comment };
});

import { adminFirestore } from "~~/server/utils/firebase";
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({
      statusCode: 400,
      message: "Missing revision id",
    });
  }

  const db = adminFirestore();
  const docSnap = await db.collection("revisions").doc(id).get();

  if (!docSnap.exists) {
    throw createError({
      statusCode: 404,
      message: "Revision not found",
    });
  }

  return docSnap.data();
});

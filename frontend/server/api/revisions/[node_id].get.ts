import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const node_id = getRouterParam(event, "node_id");
  if (!node_id) return { revisions: [] };

  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;

  // TODO should it be protected by the middleware instead?
  if (!isAuth) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  const snapshot = await db
    .collection("revisions")
    .where("node_id", "==", node_id)
    .orderBy("update_time", "desc")
    .get();

  const revisions = snapshot.docs
    .map((doc) => ({
      id: doc.id,
      ...(doc.data() as any),
    }));

  return { revisions };
});

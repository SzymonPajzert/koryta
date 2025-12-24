import { getUser } from "~~/server/utils/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const user = await getUser(event).catch(() => null);

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "Missing type or id" });
  }

  const db = getFirestore(getApp(), "koryta-pl");
  let node;
  if (user) {
    const revision = (
      await db
        .collection("revisions")
        .where("node_id", "==", id)
        .orderBy("update_time", "desc")
        .limit(1)
        .get()
    ).docs.map((doc) => doc.data())[0];
    if (revision) {
      node = { ...revision.data, node_id: revision.node_id };
    } else {
      // Fallback to original node if no revisions found
      node = await getNode(db, id);
    }
  } else {
    node = await getNode(db, id);
  }

  if (!node) {
    throw createError({ statusCode: 404, statusMessage: "Node not found" });
  }

  // Visibility filtering
  if (!user && node.visibility === "internal") {
    throw createError({
      statusCode: 404,
      statusMessage: "Node not found (internal)",
    });
  }

  return { node };
});

async function getNode(db: FirebaseFirestore.Firestore, id: string) {
  return (await db.collection("nodes").doc(id).get()).data();
}

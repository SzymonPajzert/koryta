import { getUser } from "~~/server/utils/auth";
import { getFirestore } from "firebase-admin/firestore";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  const user = await getUser(event).catch(() => null);

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "Missing type or id" });
  }

  const db = getFirestore("koryta-pl");
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
    node = { ...revision?.data, node_id: revision?.node_id };
  } else {
    const n = await db.collection("nodes").doc(id).get();
    node = n.data();
  }

  if (!node) {
    throw createError({ statusCode: 404, statusMessage: "Node not found" });
  }

  return { node };
});

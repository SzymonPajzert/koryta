import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";

export default defineEventHandler(async (event) => {
  const nodeId = getRouterParam(event, "nodeId");
  if (!nodeId) return { revisions: [] };

  const db = getFirestore(getApp(), "koryta-pl");
  // Assuming revisions are stored in 'revisions' collection or 'nodes' with history?
  // YAML said "revisions" collection.
  const snapshot = await db
    .collection("revisions")
    .where("nodeId", "==", nodeId)
    .orderBy("update_time", "desc")
    .get();

  const revisions = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return { revisions };
});

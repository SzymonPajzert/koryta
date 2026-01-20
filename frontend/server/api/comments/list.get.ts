import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { Comment } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const query = getQuery(event);
  const db = getFirestore(getApp(), "koryta-pl");

  let collectionRef = db.collection("comments") as FirebaseFirestore.Query;

  if (query.onlyLeads === "true") {
    collectionRef = collectionRef
      .where("nodeId", "==", null)
      .where("edgeId", "==", null);
  } else if (query.nodeId) {
    collectionRef = collectionRef.where("nodeId", "==", query.nodeId);
  } else if (query.edgeId) {
    collectionRef = collectionRef.where("edgeId", "==", query.edgeId);
  } else {
    console.log("No filters, returning empty list.");
    return [];
  }

  const snapshot = await collectionRef.limit(50).get();
  const comments = snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as Comment,
  );

  // Sort in memory - oldest first for conversation flow
  comments.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return comments;
});

import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { Comment } from "~~/shared/model";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";

/** The comments under a page, oldest first.
 *
 * Fresh for a signed-in reader. „Dodałem testowy komentarz, ale nie jest
 * widoczny” was reported, and taken for moderation: nothing moderates a
 * comment, but `authCachedEventHandler` held this list for six hours for
 * everybody, so the author's own refresh after posting was answered from
 * before the post. The section is drawn for signed-in readers only, so they
 * are the list's whole audience, and each of their page views now costs one
 * query: a read per comment, and the one minimum read on the many pages nobody
 * has commented on. Anybody asking without `latest` is still served from the
 * six-hour cache. */
export default editorFreshCachedEventHandler(async (event) => {
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

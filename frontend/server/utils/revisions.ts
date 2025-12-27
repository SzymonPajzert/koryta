import { Firestore, Timestamp, DocumentReference } from "firebase-admin/firestore";

export interface BatchResult {
  batch: FirebaseFirestore.WriteBatch;
  revisionRef: DocumentReference;
  targetRef: DocumentReference;
}

export function createRevisionTransaction(
  db: Firestore,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, any>,
  updateHead: boolean = false
): BatchResult {
  const batch = db.batch();
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();

  const revision = {
    node_id: targetRef.id,
    data,
    update_time: timestamp,
    update_user: user.uid,
  };

  batch.set(revisionRef, revision);

  if (updateHead) {
    batch.set(targetRef, {
      ...data,
      update_time: timestamp,
      update_user: user.uid,
    });
  }

  return { batch, revisionRef, targetRef };
}

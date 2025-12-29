import {
  Firestore,
  Timestamp,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";

export interface BatchResult {
  revisionRef: DocumentReference;
  targetRef: DocumentReference;
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, any>,
  updateHead: boolean = false,
): BatchResult {
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

  return { revisionRef, targetRef };
}

import {
  type Firestore,
  Timestamp,
  type DocumentReference,
  type WriteBatch,
} from "firebase-admin/firestore";
import type { Edge, Node } from "~~/shared/model";

export interface BatchResult {
  revisionRef: DocumentReference;
  targetRef: DocumentReference;
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Node | Edge,
  updateHead: boolean = true,
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

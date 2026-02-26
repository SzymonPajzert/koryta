import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import type { Edge, Node } from "~~/shared/model";
import { Timestamp } from "firebase-admin/firestore";

export interface BatchResult {
  revisionRef: DocumentReference;
  targetRef: DocumentReference;
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge, // TODO unify this
): BatchResult {
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();

  const revision = {
    // TODO test it is always set correctly and check if the DB has wrong entries there
    node_id: targetRef.id,
    data,
    update_time: timestamp,
    update_user: user.uid,
  };

  batch.set(revisionRef, revision);

  return { revisionRef, targetRef };
}

export async function getRevisionsForNodes(
  db: Firestore,
  nodeIds: string[],
): Promise<Record<string, unknown[]>> {
  if (nodeIds.length === 0) {
    return {};
  }

  const chunks = [];
  for (let i = 0; i < nodeIds.length; i += 10) {
    chunks.push(nodeIds.slice(i, i + 10));
  }

  const revisionsMap: Record<string, unknown[]> = {};
  nodeIds.forEach((id) => (revisionsMap[id] = []));

  for (const chunk of chunks) {
    const q = await db
      .collection("revisions")
      .where("node_id", "in", chunk)
      .get();

    q.docs.forEach((doc) => {
      const data = doc.data();
      const list = revisionsMap[data.node_id];
      if (list) {
        list.push({ id: doc.id, ...data });
      }
    });
  }

  return revisionsMap;
}

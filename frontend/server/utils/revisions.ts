import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import type { Edge, Node, Revision } from "~~/shared/model";
import { Timestamp } from "firebase-admin/firestore";

export interface BatchResult {
  revisionRef: DocumentReference;
  targetRef: DocumentReference;
}

export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T,
): Record<string, unknown> | T;
/** Overwrites nested arrays into objects with numbered keys */
export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T | undefined | null,
): Record<string, unknown> | T | undefined {
  if (data === undefined) return undefined;
  if (data === null) return undefined;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    const sanitizedArray = data.map((item) => sanitizeFirestoreData(item));
    return sanitizeFirestoreData(
      Object.fromEntries(
        sanitizedArray.map((item, index) => [index.toString(), item]),
      ),
    );
  }

  return Object.fromEntries(
    Object.entries(data)
      .map(([key, val]) => [key, sanitizeFirestoreData(val)])
      .filter(([_, val]) => val !== undefined),
  );
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge, // TODO unify this
  automatic: boolean = false,
  approve: boolean = false,
  published?: boolean,
): BatchResult {
  const revisionRef = db.collection("revisions").doc();
  const timestamp = Timestamp.now();

  const revision: Revision = {
    // TODO test it is always set correctly and check if the DB has wrong entries there
    node_id: targetRef.id,
    data: sanitizeFirestoreData(data),
    update_time: timestamp,
    update_user: user.uid,
  };

  if (automatic) {
    revision.update_automatic = true;
  }

  batch.set(revisionRef, revision);

  // The target document is fully replaced by the revision data plus the
  // node-level state (`revision_id`, `published`) that is not part of any
  // revision. Callers updating an existing document must pass `published`
  // through, otherwise the flag is dropped by the overwrite.
  const targetData = {
    ...(revision.data as Record<string, unknown>),
  };
  if (approve) {
    console.info(
      `Approving node=${targetRef.id} revision_id=${revisionRef.id}`,
    );
    targetData.revision_id = revisionRef;
  }
  if (published !== undefined) {
    targetData.published = published;
  }
  batch.set(targetRef, targetData);

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

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

/** Computed or bookkeeping fields that belong to the node, not to a revision.
 * They are regenerated (search chunks, stats) or managed elsewhere (revision
 * pointers, votes), so copying them into revision data would freeze a stale
 * snapshot. */
export const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "nameChunksLower", // used for search indexing
]);

/** The existing node's fields, to layer a partial update on top of.
 *
 * A revision is a complete snapshot and is written to the node with `set`, not
 * `merge`, so anything missing from it is dropped from the node. Callers that
 * only know some of the fields - the ingest endpoints, which carry whatever the
 * scrapers found - must start from what is already stored, or an update of one
 * field silently erases the rest.
 */
export async function baseNodeFields(
  nodeRef: DocumentReference,
): Promise<Record<string, unknown>> {
  const snapshot = await nodeRef.get();
  if (!snapshot.exists) return {};

  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot.data() ?? {})) {
    if (!INTERNAL_FIELDS.has(key)) {
      base[key] = value;
    }
  }
  return base;
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge, // TODO unify this
  automatic: boolean = false,
  approve: boolean = false,
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
  // If approve, set the current revision.
  if (approve) {
    console.info(
      `Approving node=${targetRef.id} revision_id=${revisionRef.id}`,
    );
    (revision.data as Record<string, unknown>).revision_id = revisionRef;
  }
  batch.set(targetRef, revision.data as Record<string, unknown>);

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

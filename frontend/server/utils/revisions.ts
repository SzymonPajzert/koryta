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

/** Puts a value into the shape Firestore will accept.
 *
 * Two things are not storable: `undefined`, anywhere, and an array whose
 * element is itself an array — Firestore has no array-of-arrays. Null and
 * undefined are dropped; a directly nested array becomes a map keyed by index,
 * which is the only shape left that keeps the order.
 *
 * A *top-level* array field is left as an array, and that distinction matters:
 * `parties`, `activity` and `categories` are queried with `array-contains`,
 * which matches nothing against a map and does not raise, so rewriting them
 * makes the node vanish from the filter rather than fail loudly. Until
 * 2026-07-28 this function rewrote every array it saw, which is how 461 people
 * ended up unreachable by any party filter — see
 * `scripts/migrate/unwrap-array-fields.ts`, which repairs the ones already
 * written, and `data/scrapers/src/tests/pipelines/test_invariants.py`.
 */
export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T,
): Record<string, unknown> | T;
export function sanitizeFirestoreData<T>(
  data: Record<string, unknown> | T | undefined | null,
): Record<string, unknown> | T | undefined {
  return sanitizeValue(data, false) as Record<string, unknown> | T | undefined;
}

/** @param insideArray whether `value` is an element of an array, in which case
 * an array of its own has nowhere to go and has to become a map. */
function sanitizeValue(value: unknown, insideArray: boolean): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    // Elements that sanitize away leave no hole: Firestore rejects an
    // `undefined` element outright, and the previous implementation dropped
    // them too, by way of the map it built.
    const items = value
      .map((item) => sanitizeValue(item, true))
      .filter((item) => item !== undefined);
    if (!insideArray) return items;
    return Object.fromEntries(
      items.map((item, index) => [String(index), item]),
    );
  }

  // The fields of an object are not array elements, however deeply that object
  // is nested — only an array directly inside an array is a problem.
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [key, sanitizeValue(val, false)])
      .filter(([, val]) => val !== undefined),
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

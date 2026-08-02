import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import type { Edge, Node, Revision } from "~~/shared/model";
import { revisionCollection } from "~~/shared/model";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

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
  "published",
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
    // `node_id` is the target's id whatever the target is, so without this an
    // edge revision is indistinguishable from a node one when a reviewer comes
    // to apply it.
    collection: targetRef.parent.id === "edges" ? "edges" : "nodes",
    // A revision written as approved has already had its review; anything else
    // is waiting for one.
    status: approve ? "approved" : "pending",
  };

  if (approve) {
    revision.review_user = user.uid;
    revision.review_time = timestamp;
  }

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

/** The document a revision describes, in whichever collection it belongs to. */
export function revisionTargetRef(
  db: Firestore,
  revision: { id?: string; collection?: unknown; data?: unknown } & {
    node_id?: string;
    nodeId?: string;
  },
): DocumentReference {
  const targetId = revision.node_id ?? revision.nodeId;
  if (!targetId) {
    throw createError({
      statusCode: 422,
      message: `Rewizja ${revision.id ?? "?"} nie wskazuje żadnego dokumentu.`,
    });
  }
  return db.collection(revisionCollection(revision)).doc(targetId);
}

/** Makes `revision` the one its target points at.
 *
 * The target document is a materialised copy of its approved revision, so
 * approving means writing that snapshot over it - which is also how a revision
 * can be *un*-approved by approving an older one. Everything the node owns
 * rather than the revision (`published`, and the counters the triggers
 * maintain) is carried across by hand, because the write is a `set` and would
 * otherwise drop them.
 *
 * `publish` overrides the target's current visibility; left out, approving a
 * revision never changes who can see the page.
 */
export async function applyRevision(
  db: Firestore,
  revisionRef: DocumentReference,
  revision: Revision,
  user: { uid: string },
  publish?: boolean,
): Promise<{ targetRef: DocumentReference; published: boolean }> {
  const targetRef = revisionTargetRef(db, { ...revision, id: revisionRef.id });
  const targetSnap = await targetRef.get();
  const stored = targetSnap.data() ?? {};

  const targetData: Record<string, unknown> = {
    ...(revision.data as Record<string, unknown>),
    revision_id: revisionRef,
  };

  // Kept out of the revision on purpose (see INTERNAL_FIELDS), so they have to
  // survive the overwrite explicitly.
  for (const field of ["stats", "revisions", "votes", "nameChunksLower"]) {
    if (stored[field] !== undefined) targetData[field] = stored[field];
  }

  const published = publish ?? stored.published === true;
  targetData.published = published;

  const timestamp = Timestamp.now();
  const batch = db.batch();
  batch.set(targetRef, targetData);
  batch.update(revisionRef, {
    status: "approved",
    review_user: user.uid,
    review_time: timestamp,
    reject_reason: FieldValue.delete(),
  });
  await batch.commit();

  console.info(
    `Approved revision=${revisionRef.id} target=${targetRef.path} published=${published} by=${user.uid}`,
  );
  return { targetRef, published };
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

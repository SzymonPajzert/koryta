import { createHash } from "node:crypto";
import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import type { Edge, Node, Revision } from "~~/shared/model";
import { pageIsPublic, revisionCollection } from "../../shared/model";
import { recordAudit } from "./audit";
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
 * written, and `data/pipelines/src/tests/pipelines/test_invariants.py`.
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

  // Firestore's own value types - Timestamp, DocumentReference, GeoPoint,
  // FieldValue, Buffer - are objects, but they are values rather than maps, and
  // the generic branch below would take one apart into its private fields: a
  // `Timestamp` became `{_seconds, _nanoseconds}`, which is a map as far as
  // Firestore is concerned. Maps sort *after* every timestamp, so an article
  // dated that way pinned itself above every properly dated one on /zrodla's
  // `orderBy("publishedDate", "desc")`, read back undated wherever `toDate` is
  // called, and looked "already dated" to backfill-article-dates.ts forever.
  // Every article node written through `ensureArticleNode` was one of these.
  //
  // Told apart by prototype rather than by `instanceof` against the imported
  // classes. Data destined for Firestore is plain objects all the way down - it
  // comes from `doc.data()`, from a zod parse, from ld+json - so a custom
  // prototype is the thing that marks a value type, and testing for it needs no
  // list to keep in step with the SDK. It also keeps this working under a test
  // that mocks the module, where `Timestamp` is not a constructor at all.
  // Arrays are checked first: one has a prototype of its own and would
  // otherwise be handed back whole, unsanitized.
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

  if (!isPlainObject(value)) return value;

  // The fields of an object are not array elements, however deeply that object
  // is nested — only an array directly inside an array is a problem.
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [key, sanitizeValue(val, false)])
      .filter(([, val]) => val !== undefined),
  );
}

/** Whether a value is a map to descend into, as opposed to a value to keep.
 *
 * `Object.create(null)` counts: `doc.data()` never returns one, but a caller
 * building a payload with it means a bag of fields, not a value type. */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  "merged_into", // where a duplicate page's readers are sent, see utils/merge
  "needs_split", // an admin's note that the page is two people, see nodes/split
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
  return withoutInternalFields(snapshot.data() ?? {});
}

/** The same layering base as `baseNodeFields`, for a document already read.
 *
 * Dropping `revision_id` in particular is what keeps a proposal honest: a
 * revision is a statement of what the document should say, and carrying the
 * pointer to the revision it currently says it by would freeze a stale answer
 * into it. Whether the change publishes is decided at write time, not copied
 * in from the past.
 */
export function withoutInternalFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_FIELDS.has(key)) {
      base[key] = value;
    }
  }
  return base;
}

/** The half of a stored document that `withoutInternalFields` leaves behind.
 *
 * The two partition it: a revision describes the data, and this is everything
 * else the document owns - the counters the triggers maintain, the votes,
 * whether the page is live, whether it has been removed. None of it is in any
 * revision, and a revision is written to its target with `set`, so a write that
 * does not put this back does not leave those fields alone: it deletes them.
 *
 * `stats` is the one that hurts. `/api/nodes` filters every listing on
 * `stats.isApproved == true`, and a Firestore equality filter does not match a
 * document that lacks the field at all - so a re-ingested person kept their
 * page, kept their visibility, and disappeared from every list that led to it.
 * The trigger in `functions/src/nodes.ts` only rewrites `stats.isApproved` when
 * visibility *changes*, so once visibility is carried across correctly it stops
 * covering for this.
 */
export function nodeOwnedFields(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const owned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (INTERNAL_FIELDS.has(key)) {
      owned[key] = value;
    }
  }
  return owned;
}

/** The counters a node has to carry before anything can find it, for a node
 * whose counters nothing has computed yet.
 *
 * `/api/stats/computeNodes` is what really works these out, and it writes them
 * for every node - but it is an admin endpoint somebody runs by hand, so
 * between two runs every node created in between carries no `stats` at all.

 * Only fields that are missing are filled in. A real count computed by
 * `computeNodes`, or one carried across from the stored document, always wins:
 * zero here means "nobody has counted yet", never "counted, and it is none".
 */
export function withSeededNodeStats(
  targetData: Record<string, unknown>,
): Record<string, unknown> {
  const stats = {
    ...((targetData.stats as Record<string, unknown> | undefined) ?? {}),
  };
  if (stats.nodeGroupSize === undefined) stats.nodeGroupSize = 0;
  if (stats.isApproved === undefined)
    stats.isApproved = pageIsPublic(targetData);
  return { ...targetData, stats };
}

export interface RevisionWriteOptions {
  /** Written by a pipeline rather than by a person. */
  automatic?: boolean;
  /** Approve the revision as it is written, and point the target at it. */
  approve?: boolean;
  /** The document being overwritten, where the caller is updating one that
   * already exists rather than creating it. Everything the document owns rather
   * than states is taken from here - see `nodeOwnedFields`, and note that this
   * includes its current visibility, so an update that says nothing about
   * `published` leaves it alone rather than deleting it. */
  stored?: Record<string, unknown>;
  /** Visibility, where the caller decides it rather than carrying the stored
   * document's: a document being created has none to carry, and a caller
   * publishing or hiding one is making exactly this decision. */
  published?: boolean;
}

/** Value equality for what a Firestore document holds.
 *
 * `JSON.stringify` will not do. Property order there follows insertion, and a
 * revision is assembled by spreading a payload over the stored document, so a
 * field the payload merely restates moves to the end and every comparison would
 * report a change. Firestore's own values - `Timestamp`, `DocumentReference`,
 * `GeoPoint` - are class instances that compare by identity and carry an
 * `isEqual` of their own, which is used where both sides have one: a
 * `Timestamp` stringifies to a shape that happens to work, and a
 * `DocumentReference` to one deep enough that stringifying it throws.
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return (
      a.length === b.length && a.every((item, i) => sameStoredValue(item, b[i]))
    );
  }

  const isEqual = (a as { isEqual?: unknown }).isEqual;
  if (typeof isEqual === "function") {
    return (
      typeof (b as { isEqual?: unknown }).isEqual === "function" &&
      isEqual.call(a, b) === true
    );
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) && sameStoredValue(left[key], right[key]),
  );
}

/** The document a revision write leaves behind, bar the pointer to the revision
 * itself.
 *
 * The target document is fully replaced, so everything it owns and no revision
 * carries has to be written back with it. Passing `stored` is what does that; a
 * caller creating a document has nothing to carry, and one updating an existing
 * document that leaves it out is asking for every counter, vote and flag on
 * that document to be deleted.
 *
 * The document's own state is layered *over* the revision, not under it: it
 * owns those fields, so a revision that happens to carry one - an old one
 * written before they were stripped out - does not get to restore a stale count
 * over the live one. A field absent from `stored` is not overridden, so a
 * revision that legitimately states one (a removal states `deleted`) still
 * applies to a document that has none.
 *
 * Shared with `revisionChangesNothing`, which decides whether the write is
 * worth making at all by comparing this against the document already there, so
 * the two cannot come to different conclusions about what the write would do.
 *
 * `data` is expected to be sanitised already - `createRevisionTransaction` has
 * to sanitise it for the revision anyway, and doing it twice is wasted work.
 */
function revisionTargetData(
  targetRef: DocumentReference,
  data: Record<string, unknown>,
  options: RevisionWriteOptions,
): Record<string, unknown> {
  const targetData: Record<string, unknown> = {
    ...data,
    ...nodeOwnedFields(options.stored ?? {}),
  };
  if (options.published !== undefined) {
    targetData.published = options.published;
  }
  return targetRef.parent.id === "edges"
    ? targetData
    : withSeededNodeStats(targetData);
}

/** Whether writing `data` to `targetRef` would leave it exactly as it is.
 *
 * A revision is a complete snapshot, and the ingest endpoints build one by
 * layering whatever the scrapers found over what is stored - so a payload that
 * has learned nothing since the last run yields a revision identical to the one
 * the document already carries. Written anyway it costs a revision document, a
 * rewrite of the node and every trigger that rewrite fires, on every run.
 * `CompaniesPayloads` re-submits every company already on the site, so that is
 * a few thousand revisions a run, and the history of an untouched company fills
 * up with restatements of itself.
 *
 * The comparison is against the *document*, not against the approved revision
 * it was made from: the document is that revision materialised, and it is what
 * the site actually shows. Where somebody has written a node's fields directly
 * - a migration script does - its `revision_id` points at a revision that no
 * longer matches it, and skipping here leaves that pointer stale rather than
 * refreshing it. The alternative is reading the approved revision of every
 * company in the payload to find the handful where the two differ.
 *
 * False whenever anything at all would change, bookkeeping included: a document
 * with no `revision_id` for an approval to leave in place, a visibility the
 * caller is deciding differently, or counters `withSeededNodeStats` would fill
 * in are each a reason to go ahead and write.
 */
export function revisionChangesNothing(
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge,
  options: RevisionWriteOptions = {},
): boolean {
  const { approve = false, stored } = options;
  // Nothing is stored, so the write is what creates the document.
  if (!stored) return false;
  // Approving is also what gives a document an approved revision to point at,
  // and one that has none needs writing even where it already says the right
  // thing.
  if (approve && stored.revision_id === undefined) return false;

  const next = revisionTargetData(
    targetRef,
    sanitizeFirestoreData(data) as Record<string, unknown>,
    options,
  );
  return sameStoredValue(next, stored);
}

export function createRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge, // TODO unify this
  options: RevisionWriteOptions = {},
): BatchResult {
  const { automatic = false, approve = false } = options;
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

  // Written whichever way it goes, not only when true. An absent field cannot
  // be matched by any Firestore filter, so while this wrote nothing for a human
  // proposal, the relations readers add through the edge dialogs were invisible
  // to every query that asks for human work - including the review queue at
  // /admin/rewizje/kolejka. Every reader of this field tests `=== true` or
  // `!== true`, so writing `false` changes nothing for them.
  revision.update_automatic = automatic;

  batch.set(revisionRef, revision);

  // See `revisionTargetData`, which is also what `revisionChangesNothing` asks
  // to find out whether this write is worth making.
  const targetData = revisionTargetData(
    targetRef,
    revision.data as Record<string, unknown>,
    options,
  );
  if (approve) {
    console.info(
      `Approving node=${targetRef.id} revision_id=${revisionRef.id}`,
    );
    targetData.revision_id = revisionRef;
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

  // Kept out of the revision on purpose (see INTERNAL_FIELDS), so it has to
  // survive the overwrite explicitly - the same carry `createRevisionTransaction`
  // makes, through the same function, so the two cannot drift apart on which
  // fields a document owns. A removal revision states `deleted` in its own data
  // and so still applies, but approving an ordinary edit no longer resurrects a
  // page somebody had removed.
  const targetData: Record<string, unknown> = {
    ...(revision.data as Record<string, unknown>),
    ...nodeOwnedFields(stored),
    revision_id: revisionRef,
  };

  const published = publish ?? stored.published === true;
  targetData.published = published;

  const timestamp = Timestamp.now();
  const batch = db.batch();
  batch.set(
    targetRef,
    targetRef.parent.id === "nodes"
      ? withSeededNodeStats(targetData)
      : targetData,
  );
  batch.update(revisionRef, {
    status: "approved",
    review_user: user.uid,
    review_time: timestamp,
    reject_reason: FieldValue.delete(),
  });
  // In the same commit as the approval it describes - `review_user` on the
  // revision holds only the latest verdict, so it cannot say who chose the
  // version that an older re-approval has since replaced.
  recordAudit(
    db,
    {
      action: "approve",
      collection: targetRef.parent.id === "edges" ? "edges" : "nodes",
      target_id: targetRef.id,
      revision_id: revisionRef.id,
      user: user.uid,
    },
    batch,
  );
  await batch.commit();

  console.info(
    `Approved revision=${revisionRef.id} target=${targetRef.path} published=${published} by=${user.uid}`,
  );
  return { targetRef, published };
}

/** The document id a standing proposal is stored under.
 *
 * Derived from the target and what is being proposed, so restating the same
 * offer lands on the same document. Two genuinely different proposals about one
 * document stay two documents, which is what a reviewer needs to see.
 *
 * `key` is what "the same offer" means, when the caller has a better answer
 * than the literal content. An edge does: PKW writes one committee in whatever
 * case the spreadsheet had, so hashing the raw text would file the same
 * proposal again under every spelling, while `edgeIdentity` already folds that
 * away. Without one the content is used, with its keys sorted - it is assembled
 * by spreading objects together, and property order there follows insertion,
 * which the id should not depend on.
 */
export function proposalId(
  targetId: string,
  data: Record<string, unknown> | Node | Edge,
  key?: string,
): string {
  const subject =
    key ??
    JSON.stringify(
      Object.entries(data as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  const digest = createHash("sha1")
    .update(subject)
    .digest("base64url")
    .slice(0, 10);
  return `proposal_${targetId}_${digest}`;
}

/** Record a change to a document that already exists, without making it.
 *
 * `createRevisionTransaction` cannot express this. It writes the revision's
 * data to the target unconditionally, so a revision it was not told to approve
 * still overwrites the live document - fine where it is used, which is only
 * ever on documents this request is creating, but not a way to *propose*
 * anything about one that is already there.
 *
 * So the target is not touched at all. The revision stands as a record of what
 * the pipeline believes, `pending` until somebody acts on it; approving it goes
 * through `applyRevision` like any other. Where the caller can vouch for the
 * change it should call `createRevisionTransaction` with `approve` instead, and
 * pass the target's current `published` through so applying a change neither
 * publishes a document that was awaiting review nor hides one that was live.
 */
export function proposeRevisionTransaction(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  targetRef: DocumentReference,
  data: Record<string, unknown> | Node | Edge,
  options: {
    automatic?: boolean;
    /** What makes two proposals the same one, when the content is a poorer
     * answer than the caller's. See `proposalId`. */
    key?: string;
  } = {},
): BatchResult {
  // A proposal is addressed by what it proposes, not by when it was made. An
  // applied revision is history and each one is its own record; a proposal is a
  // standing offer, and the pipeline restates it on every run until somebody
  // acts on it. With a fresh id each time, the unrecognised committees - the
  // majority, since `committee_to_party` names about twenty-five - would add a
  // revision per candidacy per night, forever.
  const revisionRef = db
    .collection("revisions")
    .doc(proposalId(targetRef.id, data, options.key));

  const revision: Revision = {
    node_id: targetRef.id,
    data: sanitizeFirestoreData(data),
    update_time: Timestamp.now(),
    update_user: user.uid,
    collection: targetRef.parent.id === "edges" ? "edges" : "nodes",
    status: "pending",
  };
  // Unconditionally, for the reason given in `createRevisionTransaction`.
  revision.update_automatic = options.automatic === true;

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

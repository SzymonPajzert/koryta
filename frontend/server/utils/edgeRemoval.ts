import { FieldValue } from "firebase-admin/firestore";
import type {
  DocumentReference,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { recordAudit } from "~~/server/utils/audit";

/** Takes one relation off the graph, inside the caller's batch.
 *
 * What `/api/edges/delete` does for an administrator's click, shared so that
 * `scripts/migrate/remove-namesake-jobs.ts` removing a hundred of them is the
 * same removal and the two cannot drift apart - the reasoning `merge.ts` gives
 * for the merge button and `merge-duplicate-people.ts`.
 *
 * A soft delete, like every other removal here: `deleted: true` rather than a
 * document that stops existing. `pageIsPublic` already reads the flag, so the
 * relation leaves the public graph on the next read, and the revision written
 * alongside keeps who removed it and why - which is the whole record of a
 * merge going wrong, and the only thing left to read if it has to be undone.
 *
 * `data` is the stored document. The caller decides it is live; one already
 * carrying `deleted: true` needs no second removal revision.
 */
export async function removeEdgeInBatch(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  edgeRef: DocumentReference,
  data: Record<string, unknown>,
  reason: string,
): Promise<{ revisionId: string }> {
  // `deleted` and `delete_reason` are fields the document owns, so
  // `createRevisionTransaction` layers whatever `stored` says for them back
  // over the revision. Withholding both is what lets this revision be the one
  // that states them - an edge carrying `deleted: false` outright would
  // otherwise undo the removal on the way out. Same reasoning as the article
  // relation helper, which removes edges the same way.
  const { deleted: _wasDeleted, delete_reason: _oldReason, ...stored } = data;

  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    edgeRef,
    {
      ...withoutInternalFields(data),
      deleted: true,
      delete_reason: reason,
    },
    // Approved as it is written: an admin removing a relation *is* the review
    // of it, so it does not go on a queue for somebody to confirm.
    { stored, approve: true, published: false },
  );

  recordAudit(
    db,
    {
      action: "delete",
      collection: "edges",
      target_id: edgeRef.id,
      revision_id: revisionRef.id,
      user: user.uid,
      reason,
    },
    batch,
  );

  // A fact promoted into this relation says so on its card („Powiązanie
  // utworzone”, pointing at „Historia powiązań”), which stops being true now.
  // Taken off in the same batch, so the fact offers the promotion again.
  const promotedFrom = await db
    .collection("extractions")
    .where("promotedEdgeIds", "array-contains", edgeRef.id)
    .get();
  for (const fact of promotedFrom.docs) {
    batch.update(fact.ref, {
      promotedEdgeIds: FieldValue.arrayRemove(edgeRef.id),
    });
  }

  return { revisionId: revisionRef.id };
}

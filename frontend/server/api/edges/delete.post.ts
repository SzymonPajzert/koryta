import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { recordAudit } from "~~/server/utils/audit";
import { z } from "zod";

const bodyValidator = z.object({
  edge_id: z.string().min(1),
  reason: z.string().trim().min(1, "Powód usunięcia jest wymagany"),
});

export type EdgeDeleted = {
  edge_id: string;
  deleted: true;
  /** The removal revision written for it, or null when the edge was already
   * gone and nothing new was recorded. */
  revision_id: string | null;
};

/** Takes one relation off the graph, on an administrator's own authority.
 *
 * The reviewed route - propose, queue, approve - is the right one for a claim
 * somebody disagrees with. This is for a relation that is not a claim at all:
 * two people merged into one node bring their employers with them, and the
 * relations that came off the wrong half assert something nobody ever said.
 * Making an admin file a proposal against themselves to clear one adds a queue
 * entry and a second click, and the verdict was never in doubt.
 *
 * A soft delete, like every other removal here: `deleted: true` rather than a
 * document that stops existing. `pageIsPublic` already reads the flag, so the
 * relation leaves the public graph on the next read, and the revision written
 * alongside keeps who removed it and why - which is the whole record of a
 * merge going wrong, and the only thing left to read if it has to be undone.
 */
export default defineEventHandler(async (event): Promise<EdgeDeleted> => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const edgeRef = db.collection("edges").doc(body.edge_id);
  const snapshot = await edgeRef.get();
  if (!snapshot.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma powiązania o id: ${body.edge_id}`,
    });
  }

  const data = snapshot.data() ?? {};
  // Idempotent rather than a 409: two admins clearing the same bad merge, or
  // one double-clicking, both mean the relation is gone. Writing a second
  // removal revision would only add a duplicate to its history.
  if (data.deleted === true) {
    return { edge_id: body.edge_id, deleted: true, revision_id: null };
  }

  // `deleted` and `delete_reason` are fields the document owns, so
  // `createRevisionTransaction` layers whatever `stored` says for them back
  // over the revision. Withholding both is what lets this revision be the one
  // that states them - an edge carrying `deleted: false` outright would
  // otherwise undo the removal on the way out. Same reasoning as the article
  // relation helper, which removes edges the same way.
  const { deleted: _wasDeleted, delete_reason: _oldReason, ...stored } = data;

  const batch = db.batch();
  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    edgeRef,
    {
      ...withoutInternalFields(data),
      deleted: true,
      delete_reason: body.reason,
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
      reason: body.reason,
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

  await batch.commit();

  // The entity and graph endpoints are cached per handler for six hours, so a
  // relation removed now would otherwise stay on the page for the rest of the
  // day. Same clear as /api/edges/publish.
  await useStorage("cache").clear("nitro:handlers");

  return { edge_id: body.edge_id, deleted: true, revision_id: revisionRef.id };
});

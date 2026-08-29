import { getFirestore } from "firebase-admin/firestore";
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
});

export type EdgeRestored = {
  edge_id: string;
  restored: boolean;
  /** The revision written for it, or null when the relation was not removed in
   * the first place and nothing new was recorded. */
  revision_id: string | null;
  /** Whether the relation is back on the public site. Always false today, and
   * said out loud because it is the surprising half of this: a removal hid the
   * relation *and* unpublished it, and only the hiding is undone here. */
  published: boolean;
};

/** Puts back a relation an admin removed.
 *
 * The exact mirror of /api/edges/delete, and it has to be: `deleted` and
 * `delete_reason` are fields the document owns, so `createRevisionTransaction`
 * layers whatever `stored` says for them back over the revision. Withholding
 * both is what lets this write be the one that settles them - and because the
 * target write is a full `set`, withholding them means the document comes back
 * with neither key rather than with `deleted: false`.
 *
 * That distinction is not cosmetic. Every reader tests `deleted === true` or
 * `!== true`, so `false` and absent look identical to all of them - but
 * `applyRevision` layers the *stored* value over a revision it is applying, so
 * a document carrying `deleted: false` would silently cancel the next removal
 * somebody approved against it.
 *
 * `published` is deliberately not touched: the removal set it false, the value
 * it had before that is recorded nowhere, and guessing would be the one way
 * this endpoint could put something back in front of the public that nobody
 * re-reviewed. The relation returns as a draft and re-enters the queue at
 * /admin/krawedzie, which is where the decision to show it belongs.
 *
 * Edges only. A node is removed by approving a removal revision rather than
 * through an endpoint, and its `published` is never lowered on the way out - so
 * clearing `deleted` there would put the page and every relation around it back
 * on the site in one write, with no review. That wants its own thought and its
 * own endpoint.
 */
export default defineEventHandler(async (event): Promise<EdgeRestored> => {
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
  // Idempotent, like the removal it undoes: two admins clicking the same row,
  // or one double-clicking, both mean the relation is back. Writing a second
  // restore revision would only add a duplicate to its history and repoint
  // `revision_id` at a revision that changed nothing.
  if (data.deleted !== true) {
    return {
      edge_id: body.edge_id,
      restored: true,
      revision_id: null,
      published: data.published === true,
    };
  }

  const { deleted: _wasDeleted, delete_reason: _reason, ...stored } = data;

  const batch = db.batch();
  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    edgeRef,
    // `withoutInternalFields` already drops `deleted` and `delete_reason`, so
    // the revision states the relation as it was and says nothing about its
    // removal - which is what retracting the removal looks like.
    withoutInternalFields(data),
    // No `published` option, so the stored `false` carries through. Approved as
    // it is written, and that is the point of writing a revision at all rather
    // than a bare update: `revision_id` has to stop pointing at the removal.
    // Left where it was, re-approving it from /admin/rewizje would silently
    // delete the relation again, and /api/revisions/reject refuses to retire
    // the revision a document points at.
    { stored, approve: true },
  );

  recordAudit(
    db,
    {
      action: "restore",
      collection: "edges",
      target_id: edgeRef.id,
      revision_id: revisionRef.id,
      user: user.uid,
    },
    batch,
  );

  await batch.commit();

  // Six hours of per-handler cache otherwise stands between the restored
  // relation and the page it belongs on. Same clear as the removal.
  await useStorage("cache").clear("nitro:handlers");

  return {
    edge_id: body.edge_id,
    restored: true,
    revision_id: revisionRef.id,
    // What was actually written, not a constant: `published` is carried from
    // the stored document rather than set here, so reporting a hardcoded false
    // would be a guess about somebody else's write.
    published: data.published === true,
  };
});

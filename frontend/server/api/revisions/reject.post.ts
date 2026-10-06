import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { revisionTargetRef } from "~~/server/utils/revisions";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import { recordAudit } from "~~/server/utils/audit";
import { forgetQueued } from "~~/server/utils/queueScan";
import { approvedRevisionId } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  revision_id: z.string(),
  reason: z.string().trim().min(1, "Powód odrzucenia jest wymagany"),
});

/** Turns a suggestion down, with a reason.
 *
 * The revision is kept - it is the record of what somebody proposed and why it
 * was not taken - but it stops counting as pending, so a queue of suggestions
 * can actually be worked through instead of growing forever.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );
  const user = await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const revisionRef = db.collection("revisions").doc(body.revision_id);
  const revisionSnap = await revisionRef.get();
  if (!revisionSnap.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma rewizji o id=${body.revision_id}`,
    });
  }

  const revision = revisionSnap.data() ?? {};
  const targetRef = revisionTargetRef(db, { ...revision, id: revisionRef.id });
  const targetId = targetRef.id;

  // Rejecting the snapshot a page is currently serving would leave it saying
  // something nobody stands behind. Approve a different revision first.
  const stored = (await targetRef.get()).data();
  if (approvedRevisionId(stored?.revision_id) === body.revision_id) {
    throw createError({
      statusCode: 409,
      message:
        "Nie można odrzucić rewizji, która jest w tej chwili zatwierdzona. Zatwierdź inną wersję albo ukryj stronę.",
    });
  }

  const batch = db.batch();
  batch.update(revisionRef, {
    status: "rejected",
    reject_reason: body.reason,
    review_user: user.uid,
    review_time: Timestamp.now(),
  });
  recordAudit(
    db,
    {
      action: "reject",
      collection: targetRef.parent.id === "edges" ? "edges" : "nodes",
      target_id: targetId,
      revision_id: body.revision_id,
      user: user.uid,
      reason: body.reason,
    },
    batch,
  );
  await batch.commit();
  forgetQueued(body.revision_id, "rejected");

  // A rejection is the one verdict the author cannot discover by looking at the
  // page, so the reason only reaches them if it is sent.
  await notifyRevisionReviewed(db, {
    decision: "rejected",
    revisionId: body.revision_id,
    revision,
    targetRef,
    reason: body.reason,
    reviewerUid: user.uid,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
  });

  return { revision_id: body.revision_id, status: "rejected" };
});

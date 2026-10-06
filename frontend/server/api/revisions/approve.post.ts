import { getFirestore } from "firebase-admin/firestore";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { applyRevision, revisionTargetRef } from "~~/server/utils/revisions";
import { notifyRevisionReviewed } from "~~/server/utils/revisionNotifications";
import { resolveEdgeEndpoints } from "~~/server/utils/edgePublication";
import { forgetQueued } from "~~/server/utils/queueScan";
import type { Edge, Revision } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  revision_id: z.string(),
  /** Publish the target in the same step. Left out, approving changes what the
   * page says without changing who can see it. */
  publish: z.boolean().optional(),
});

/** Refuses to leave an edge published while one of its ends is a draft.
 *
 * Only edges are checked, and only when the write would end with the edge
 * live. A node revision cannot break the rule; an edge revision can, both by
 * being published outright and by moving an end of an already published edge
 * onto a page nobody can open.
 */
async function assertEdgeRevisionPublishable(
  db: Firestore,
  revisionRef: DocumentReference,
  revision: Partial<Revision>,
  publish: boolean | undefined,
): Promise<void> {
  const targetRef = revisionTargetRef(db, {
    ...revision,
    id: revisionRef.id,
  } as Parameters<typeof revisionTargetRef>[1]);
  if (targetRef.parent.id !== "edges") return;

  const stored = (await targetRef.get()).data() ?? {};
  const willBePublished = publish ?? stored.published === true;
  if (!willBePublished) return;

  const data = (revision.data ?? {}) as Partial<Edge>;
  const source = data.source ?? (stored.source as string | undefined);
  const target = data.target ?? (stored.target as string | undefined);
  if (!source || !target) return;

  const endpoints = await resolveEdgeEndpoints(db, [
    { id: targetRef.id, source, target },
  ]);
  const state = endpoints.get(targetRef.id);
  if (state?.publishable) return;

  const names = (state?.blockedBy ?? []).map((node) => node.name ?? node.id);
  throw createError({
    statusCode: 400,
    message: `Nie można opublikować powiązania, którego druga strona nie jest opublikowana: ${names.join(
      ", ",
    )}.`,
  });
}

/** Makes a revision the approved one for its node or edge.
 *
 * Until this existed, `revision_id` was only ever written as a side effect of
 * an ingest writing a revision of its own, so nothing a person suggested could
 * be accepted. Approving is idempotent: re-approving the revision a target
 * already points at rewrites the same snapshot.
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

  // `data` is required by the type but not by anything that wrote these
  // documents, and applying a revision that has none would blank the target.
  const revision = revisionSnap.data() as Partial<Revision>;
  if (!revision.data) {
    throw createError({
      statusCode: 422,
      message: `Rewizja ${body.revision_id} nie ma danych do zatwierdzenia.`,
    });
  }

  // Approving an edge revision can leave it published two ways: because the
  // caller asked, or because the edge was already live and `applyRevision`
  // carries that across. Either one has to answer to the rule that a relation
  // never outlives its endpoints - and the revision may itself be what moves an
  // end, so the check runs against the snapshot about to be written, not
  // against what is stored now.
  await assertEdgeRevisionPublishable(db, revisionRef, revision, body.publish);

  const { targetRef, published } = await applyRevision(
    db,
    revisionRef,
    revision as Revision,
    user,
    body.publish,
  );

  // The node and entity endpoints are cached per handler, so a page approved
  // now would otherwise keep serving its previous answer.
  await useStorage("cache").clear("nitro:handlers");
  forgetQueued(body.revision_id, "approved");

  await notifyRevisionReviewed(db, {
    decision: "approved",
    revisionId: body.revision_id,
    revision,
    targetRef,
    published,
    reviewerUid: user.uid,
    siteUrl: useRuntimeConfig(event).public.siteUrl,
  });

  return {
    revision_id: body.revision_id,
    id: targetRef.id,
    collection: targetRef.parent.id,
    published,
  };
});

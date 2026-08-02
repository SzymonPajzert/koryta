import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { applyRevision } from "~~/server/utils/revisions";
import type { Revision } from "~~/shared/model";
import { z } from "zod";

const bodyValidator = z.object({
  revision_id: z.string(),
  /** Publish the target in the same step. Left out, approving changes what the
   * page says without changing who can see it. */
  publish: z.boolean().optional(),
});

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

  return {
    revision_id: body.revision_id,
    id: targetRef.id,
    collection: targetRef.parent.id,
    published,
  };
});

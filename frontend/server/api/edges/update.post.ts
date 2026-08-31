import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  proposeRevisionTransaction,
  revisionChangesNothing,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { edgeEditSchema } from "~~/shared/api";

const bodyValidator = edgeEditSchema.extend({
  edge_id: z.string().min(1),
});

export type EdgeUpdated = {
  edge_id: string;
  /** The revision this wrote, whether it was applied or is waiting. Null when
   * nothing was written. */
  revision_id: string | null;
  /** Whether the site already says what the caller typed. False means it is a
   * standing proposal in /admin/rewizje-krawedzi instead. */
  applied: boolean;
  /** Nothing was written because the relation already said exactly this. */
  unchanged: boolean;
};

/** Corrects what one relation says: the role, the dates, the committee.
 *
 * Until this existed the only relation a reader could fix was one that did not
 * exist yet - `/api/edges/create` adds, `/api/edges/delete` removes, and an
 * employment with the wrong job title or a year out of date could only be
 * corrected by an admin deleting it and somebody typing it again. That is also
 * the shape the complaint arrived in: „Zaproponuj zmianę” on a person edits
 * their name, their party and their links, which is the least of what a page
 * about somebody's jobs actually claims.
 *
 * Who may say it is settled the same way every other write here settles it. An
 * admin's edit is its own review and applies at once, like `/api/edges/delete`;
 * anybody else's is a proposal - the revision stands, the relation is untouched
 * and /admin/rewizje-krawedzi is where it waits. The two paths write the same
 * revision, so a reviewer approving one through `/api/revisions/approve` gets
 * exactly what the admin path would have written.
 *
 * The ends of the relation and its type are not editable - see
 * `edgeEditSchema`.
 */
export default defineEventHandler(async (event): Promise<EdgeUpdated> => {
  const body = await readValidatedBody(event, (raw) =>
    bodyValidator.parse(raw),
  );
  const { edge_id, ...fields } = body;

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const edgeRef = db.collection("edges").doc(edge_id);
  const snapshot = await edgeRef.get();
  if (!snapshot.exists) {
    throw createError({
      statusCode: 404,
      message: `Nie ma powiązania o id: ${edge_id}`,
    });
  }

  const stored = snapshot.data() ?? {};
  if (stored.deleted === true) {
    throw createError({
      statusCode: 409,
      message: "To powiązanie zostało usunięte i nie da się go już zmienić.",
    });
  }

  // A revision is a complete snapshot, so the fields nobody edited have to come
  // off the stored document or the write would delete them - the same layering
  // `/api/revisions/create` does through `baseNodeFields`. Only the keys the
  // caller actually sent are overlaid: zod leaves an omitted optional field
  // undefined, and spreading that over the stored value would blank it.
  const edited = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const data = { ...withoutInternalFields(stored), ...edited };

  const isAdmin = user.admin === true;
  const published = stored.published === true;

  // Nothing to record where the relation already says this. Worth checking on
  // both paths: an admin would write a revision that changes nothing, and a
  // contributor would leave a proposal a reviewer has to open to find out it is
  // a no-op. Only meaningful for the admin path's own write, so the comparison
  // is made against what that path would produce.
  if (
    revisionChangesNothing(edgeRef, data, {
      stored,
      published,
      approve: isAdmin,
    })
  ) {
    return { edge_id, revision_id: null, applied: false, unchanged: true };
  }

  const batch = db.batch();

  if (!isAdmin) {
    const { revisionRef } = proposeRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      data,
    );
    await batch.commit();
    return {
      edge_id,
      revision_id: revisionRef.id,
      applied: false,
      unchanged: false,
    };
  }

  const { revisionRef } = createRevisionTransaction(
    db,
    batch,
    user,
    edgeRef,
    data,
    // `published` is passed through rather than decided here: correcting a date
    // on a live relation must not take it off the site, and correcting one on a
    // draft must not publish it.
    { stored, approve: true, published },
  );

  // No `audit` entry beside it, unlike /api/edges/delete. That collection is
  // for the decisions that leave no other document behind; this one leaves an
  // approved revision carrying `update_user` and `review_user`, which is the
  // same record in the place a reviewer already looks for it.
  await batch.commit();

  // The entity and graph endpoints are cached per handler for six hours, so the
  // correction would otherwise not reach the page it was typed on until
  // tomorrow. Same clear as /api/edges/delete.
  await useStorage("cache").clear("nitro:handlers");

  return {
    edge_id,
    revision_id: revisionRef.id,
    applied: true,
    unchanged: false,
  };
});

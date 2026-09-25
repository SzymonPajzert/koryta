import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { requireAdmin } from "~~/server/utils/auth";
import { purgeContractLinkCaches } from "~~/server/utils/cache";
import { refreshContractLinkSummary } from "~~/server/utils/contractLinks";
import {
  CONTRACT_LINK_COLLECTION,
  contractLinkVisibilities,
} from "~~/shared/contractLinks";

/** Name a finding to everybody, or take it back behind the login.
 *
 * Admin only: who is named on the public site is the one decision that is not
 * open to everyone (`requireAdmin`). The pipeline sets a default per finding;
 * this is the owner overruling it from the page, one card at a time, without a
 * re-run. The next pipeline run writes its own default again, so a decision
 * that should stick belongs in the pipeline's `--public`/`--gate` lists.
 */

const bodySchema = z.object({
  id: z.string().regex(/^cru_\d{10}$/),
  visibility: z.enum(contractLinkVisibilities),
});

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) => bodySchema.parse(body));
  await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const ref = db.collection(CONTRACT_LINK_COLLECTION).doc(body.id);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw createError({
      statusCode: 404,
      message: "Nie ma takiego powiązania.",
    });
  }
  await ref.update({ visibility: body.visibility });

  // The summary counts public and gated findings; keep it true.
  await refreshContractLinkSummary(db, new Date().toISOString());

  // A finding taken back behind the login must stop being named now: in the
  // cached list and detail, and in the rendered page that embeds them.
  await purgeContractLinkCaches();
  return { id: body.id, visibility: body.visibility };
});

import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import {
  decideExtract,
  linkedOnAPage,
  OVERVIEW_CACHE_BASE,
  type DecidedExtract,
} from "~~/server/utils/declarationDecisions";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";

/**
 * An admin takes a crop back from /admin/oswiadczenia: it is not the
 * person's, or not a declaration at all (`decideExtract`). Readers are not
 * sent it again, its reading stops counting for its pages, and it leaves the
 * admin's lists. A public page that linked it stops showing it, at once:
 * the pages' cached answers are dropped (`linkedOnAPage`). Admins only,
 * checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<DecidedExtract> => {
  const admin = await requireAdmin(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const id = getRouterParam(event, "id") ?? "";
  if (!EXTRACT_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 404, message: "Nie ma takiego wycinka." });
  }
  const db = getFirestore(getApp(), "koryta-pl");
  const decided = await decideExtract(db, {
    extractId: id,
    uid: admin.uid,
    decision: { verdict: "withdraw" },
  });
  if (await linkedOnAPage(db, id)) {
    await useStorage("cache").clear("nitro:handlers");
  }
  await useStorage("cache").clear(OVERVIEW_CACHE_BASE);
  return decided;
});

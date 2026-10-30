import type { Firestore } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { H3Event } from "h3";
import { EXTRACT_ID_PATTERN } from "~~/shared/declarations";
import { requireAdmin } from "./auth";
import { linkedOnAPage, OVERVIEW_CACHE_BASE } from "./declarationDecisions";
/** The start of an admin's decision on one crop (settle.post.ts,
 * withdraw.post.ts): the admin, checked before anything is read, the crop's
 * id from the route (a 404 for one that cannot be a crop's), and an answer
 * nobody caches. */
export async function decisionRequest(
  event: H3Event,
): Promise<{ uid: string; id: string; db: Firestore }> {
  const admin = await requireAdmin(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const id = getRouterParam(event, "id") ?? "";
  if (!EXTRACT_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 404, message: "Nie ma takiego wycinka." });
  }
  return { uid: admin.uid, id, db: getFirestore(getApp(), "koryta-pl") };
}

/** After a decision: the pages' cached answers go where a public page linked
 * the crop (`linkedOnAPage`) or the pass after it published somebody, and
 * the overview's always, so the reload shows the decision. */
export async function afterDecision(
  db: Firestore,
  id: string,
  published = false,
): Promise<void> {
  if (published || (await linkedOnAPage(db, id))) {
    await useStorage("cache").clear("nitro:handlers");
  }
  await useStorage("cache").clear(OVERVIEW_CACHE_BASE);
}

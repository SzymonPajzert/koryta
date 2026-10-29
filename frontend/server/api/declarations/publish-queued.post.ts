import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { drainPublications } from "~~/server/utils/declarationPublish";
import { publishLimitOf, type DrainResult } from "~~/shared/declarations";

/**
 * The button on /admin/oswiadczenia: takes up the queue of people whose birth
 * date matches their declaration now, rather than at the next answer or
 * upload (`drainPublications`). Under the same daily limit and the same night
 * window as every other pass - the admin asks for the queue to move, not for
 * the limit to be lifted.
 *
 * Answers with who went up, who was held and why, and whether the day's limit
 * stopped it.
 */
export default defineEventHandler(async (event): Promise<DrainResult> => {
  await requireAdmin(event);
  const result = await drainPublications(
    getFirestore(getApp(), "koryta-pl"),
    new Date(),
    publishLimitOf(useRuntimeConfig(event)),
  );
  if (result.published.length > 0) {
    await useStorage("cache").clear("nitro:handlers");
  }
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return result;
});

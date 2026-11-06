import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { OVERVIEW_CACHE_BASE } from "~~/server/utils/declarationDecisions";
import { recheckPublication } from "~~/server/utils/declarationPublish";
import type { RecheckResult } from "~~/shared/declarations";

/**
 * „Sprawdź ponownie” on /admin/oswiadczenia: asks a held page again, through
 * every check an automatic publication goes through (`recheckPublication`),
 * and publishes it if they pass. Answers with what came of it, which is what
 * the page tells the admin. Admins only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<RecheckResult> => {
  const { uid, id, db } = await holdRequest(event);
  const result = await recheckPublication(db, id, uid);
  if (result.outcome === "published") {
    await useStorage("cache").clear("nitro:handlers");
  }
  await useStorage("cache").clear(OVERVIEW_CACHE_BASE);
  return result;
});

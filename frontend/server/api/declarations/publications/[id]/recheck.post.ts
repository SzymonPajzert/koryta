import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { restageDeclarationPeople } from "~~/server/utils/declarationPeopleCount";
import { recheckPublication } from "~~/server/utils/declarationPublish";
import type { RecheckResult } from "~~/shared/declarations";

/**
 * „Sprawdź ponownie” on /admin/oswiadczenia: asks a held page again, through
 * every check an automatic publication goes through (`recheckPublication`),
 * and publishes it if they pass. Answers with what came of it, which is what
 * the page tells the admin, and the person moves in the people count. Admins
 * only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<RecheckResult> => {
  const { uid, id, db } = await holdRequest(event);
  const result = await recheckPublication(db, id, uid);
  if (result.outcome === "published") {
    await useStorage("cache").clear("nitro:handlers");
  }
  if (result.outcome !== "skipped") await restageDeclarationPeople(db, [id]);
  return result;
});

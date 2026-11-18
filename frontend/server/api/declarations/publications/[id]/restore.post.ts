import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import {
  OVERVIEW_CACHE_BASE,
  restorePublication,
} from "~~/server/utils/declarationDecisions";
import { restageDeclarationPeople } from "~~/server/utils/declarationPeopleCount";

/**
 * „Przywróć” on /admin/oswiadczenia: takes an admin's „Nie publikuj” back, and
 * the person is held again for what they were held for (`restorePublication`).
 * Admins only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<{ id: string }> => {
  const { id, db } = await holdRequest(event);
  await restorePublication(db, id);
  await restageDeclarationPeople(db, [id]);
  await useStorage("cache").clear(OVERVIEW_CACHE_BASE);
  return { id };
});

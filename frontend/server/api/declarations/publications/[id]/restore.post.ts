import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { restorePublication } from "~~/server/utils/declarationDecisions";
import { restageDeclarationPeople } from "~~/server/utils/declarationPeopleCount";

/**
 * „Przywróć” on /admin/oswiadczenia: takes an admin's „Nie publikuj” back, and
 * the person waits again for what they were held for (`restorePublication`).
 * Admins only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<{ id: string }> => {
  const { id, db } = await holdRequest(event);
  await restorePublication(db, id);
  await restageDeclarationPeople(db, [id]);
  return { id };
});

import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import {
  declinePublication,
  OVERVIEW_CACHE_BASE,
} from "~~/server/utils/declarationDecisions";
import { restageDeclarationPeople } from "~~/server/utils/declarationPeopleCount";

/**
 * „Nie publikuj” on /admin/oswiadczenia: the person leaves the held list for
 * the people who will not be published (`declinePublication`). Admins only,
 * checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<{ id: string }> => {
  const { uid, id, db } = await holdRequest(event);
  await declinePublication(db, id, uid);
  await restageDeclarationPeople(db, [id]);
  await useStorage("cache").clear(OVERVIEW_CACHE_BASE);
  return { id };
});

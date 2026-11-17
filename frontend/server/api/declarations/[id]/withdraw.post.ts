import {
  decideExtract,
  type DecidedExtract,
} from "~~/server/utils/declarationDecisions";
import {
  afterDecision,
  decisionRequest,
} from "~~/server/utils/declarationDecisionRequest";
import { restageCropPeople } from "~~/server/utils/declarationPeopleCount";

/**
 * An admin takes a crop back from /admin/oswiadczenia: it is not the
 * person's, or not a declaration at all (`decideExtract`). Readers are not
 * sent it again, its reading stops counting for its pages, and it leaves the
 * admin's lists. A public page that linked it stops showing it, at once:
 * the pages' cached answers are dropped (`linkedOnAPage`), and its people
 * move in the people count. Admins only, checked before anything is read.
 */
export default defineEventHandler(async (event): Promise<DecidedExtract> => {
  const { uid, id, db } = await decisionRequest(event);
  const decided = await decideExtract(db, {
    extractId: id,
    uid,
    decision: { verdict: "withdraw" },
  });
  await restageCropPeople(db, [id]);
  await afterDecision(db, id);
  return decided;
});

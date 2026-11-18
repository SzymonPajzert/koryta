import { holdRequest } from "~~/server/utils/declarationDecisionRequest";
import { waitsForAdmin } from "~~/server/utils/declarationDecisions";
import { peopleById, reviewRow } from "~~/server/utils/declarationOverview";
import { readingsOfAnotherDay } from "~~/server/utils/declarationPublish";
import type { HeldCropRow } from "~~/shared/declarations";

/**
 * The crops that give a held page another birth date, as the rows of
 * /admin/oswiadczenia decide them: what `conflicting_reading` holds it for. The
 * list „Inna data niż na stronie” shows only the newest of them, and on
 * 2026-11-06 none of the 25 crops behind the 20 holds were among its 20 rows,
 * so a row asks for its own. A crop settled already - another page's
 * declaration, read with that page's date - is listed as one nobody decides
 * here (`decidable`). Admins only, checked before anything is read: the pages'
 * dates and what readers typed are read here.
 */
export default defineEventHandler(async (event): Promise<HeldCropRow[]> => {
  const { id, db } = await holdRequest(event);
  const page = await db.collection("nodes").doc(id).get();
  const born = page.get("birthDate");
  if (typeof born !== "string" || !born) return [];
  const crops = await readingsOfAnotherDay(db, id, born.trim());
  const people = await peopleById(
    db,
    crops.flatMap(
      (crop) => (crop.get("personIds") as string[] | undefined) ?? [],
    ),
  );
  return crops.map((crop) => ({
    ...reviewRow(crop, people),
    decidable: waitsForAdmin(crop.data()),
  }));
});

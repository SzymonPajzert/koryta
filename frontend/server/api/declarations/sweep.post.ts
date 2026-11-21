import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { restageDeclarationPeople } from "~~/server/utils/declarationPeopleCount";
import { sweepDeclarations } from "~~/server/utils/declarationPublish";
import { publishLimitOf, type SweepResult } from "~~/shared/declarations";

/**
 * What the job on predator calls after each upload of declaration crops:
 * compares again the settled readings that have not met their pages yet, or
 * whose pages had no birth date, places again the readings of declarations'
 * posts a comparison missed, and takes up the publication queue
 * (`sweepDeclarations`). Scoped like the upload, to the datascience group.
 * The pages it moved move in the people count.
 *
 * Answers with what it did, for the job's log. Publishes nothing while the
 * daily limit is 0, or inside the people import's night window.
 */
export default defineEventHandler(async (event): Promise<SweepResult> => {
  requireDatascience(await getUser(event));
  const db = getFirestore(getApp(), "koryta-pl");
  const { touched, ...result } = await sweepDeclarations(
    db,
    new Date(),
    publishLimitOf(useRuntimeConfig(event)),
  );
  if (result.drain.published.length > 0) {
    await useStorage("cache").clear("nitro:handlers");
  }
  await restageDeclarationPeople(db, touched);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return result;
});

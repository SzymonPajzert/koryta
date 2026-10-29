import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser, requireDatascience } from "~~/server/utils/auth";
import { sweepDeclarations } from "~~/server/utils/declarationPublish";
import { publishLimitOf, type SweepResult } from "~~/shared/declarations";

/**
 * What the job on predator calls after each upload of declaration crops:
 * compares again the settled readings that have not met their pages yet, or
 * whose pages had no birth date, and takes up the publication queue
 * (`sweepDeclarations`). Scoped like the upload, to the datascience group.
 *
 * Answers with what it did, for the job's log. Publishes nothing while the
 * daily limit is 0, or inside the people import's night window.
 */
export default defineEventHandler(async (event): Promise<SweepResult> => {
  requireDatascience(await getUser(event));
  const result = await sweepDeclarations(
    getFirestore(getApp(), "koryta-pl"),
    new Date(),
    publishLimitOf(useRuntimeConfig(event)),
  );
  if (result.drain.published.length > 0) {
    await useStorage("cache").clear("nitro:handlers");
  }
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return result;
});

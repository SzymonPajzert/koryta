import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { drainPublications } from "~~/server/utils/declarationPublish";
import {
  PRESS_BATCH,
  publishLimitOf,
  type DrainResult,
} from "~~/shared/declarations";

/**
 * The button „Opublikuj z kolejki” on /admin/oswiadczenia: publishes the
 * people whose birth date matches their declaration now, past the automatic
 * daily limit and also while the automatic publication is switched off
 * (Szymon, 2026-10-30: "it's an admin decision"), at most `PRESS_BATCH` of
 * them a press (`drainPublications` with `pressedBy`).
 *
 * Every page still goes through every check of `publishPage`, and one a check
 * stops is held as it would be for the automation. Not inside the people
 * import's night window, nor while an import runs: the import's stale write
 * would take the page down again. A press takes none of the automation's
 * places of the day, so „Dziś” goes on counting only what the automation
 * published, and the record of each page it takes up names the admin.
 *
 * Answers with who went up, who was held and why, why nobody did, and how
 * many still wait, which is what the page tells the admin.
 */
export default defineEventHandler(async (event): Promise<DrainResult> => {
  const admin = await requireAdmin(event);
  const result = await drainPublications(
    getFirestore(getApp(), "koryta-pl"),
    new Date(),
    publishLimitOf(useRuntimeConfig(event)),
    { pressedBy: admin.uid, maxPages: PRESS_BATCH },
  );
  if (result.published.length > 0) {
    await useStorage("cache").clear("nitro:handlers");
  }
  setResponseHeader(event, "Cache-Control", "private, no-store");
  return result;
});

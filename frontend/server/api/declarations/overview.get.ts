import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { countEverything } from "~~/server/utils/declarationOverview";
import type { DeclarationOverview } from "~~/shared/declarations";

/**
 * Everything /admin/oswiadczenia shows: how far the searches, the readings and
 * the publications got, and the lists an admin works through.
 *
 * The admin gate runs before anything is read; the computation is then shared
 * between admins for two minutes, since the answer does not depend on who
 * asks. Admins see the readers' readings and the pages' dates, which readers
 * never do.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const limit = Number(useRuntimeConfig().declarationsDailyPublishLimit) || 0;
  return overview(limit);
});

const overview = defineCachedFunction(
  async (dailyLimit: number): Promise<DeclarationOverview> =>
    countEverything(
      getFirestore(getApp(), "koryta-pl"),
      dailyLimit,
      new Date(),
    ),
  {
    name: "declarationOverview",
    maxAge: 120,
    swr: false,
    getKey: (dailyLimit: number) => String(dailyLimit),
  },
);

import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { OVERVIEW_CACHE } from "~~/server/utils/declarationDecisions";
import {
  countTotals,
  reviewLists,
  withLists,
} from "~~/server/utils/declarationOverview";
import type { DeclarationOverview } from "~~/shared/declarations";

/**
 * Everything /admin/oswiadczenia shows: how far the searches, the readings and
 * the publications got, and the lists an admin works through.
 *
 * The admin gate runs before anything is read. The counts are shared between
 * admins for two minutes (`OVERVIEW_CACHE`): they cost most of the reads and
 * do not depend on who asks. The lists are read on every request, so a
 * decision shows on the next load wherever it was made, on any instance;
 * they cost a few thousand reads, an eighth of the whole. Admins see the
 * readers' readings and the pages' dates, which readers never do.
 */
export default defineEventHandler(
  async (event): Promise<DeclarationOverview> => {
    await requireAdmin(event);
    setResponseHeader(event, "Cache-Control", "private, no-store");
    const limit = Number(useRuntimeConfig().declarationsDailyPublishLimit) || 0;
    const [totals, lists] = await Promise.all([
      overviewTotals(limit),
      reviewLists(getFirestore(getApp(), "koryta-pl")),
    ]);
    return withLists(totals, lists, new Date());
  },
);

const overviewTotals = defineCachedFunction(
  async (dailyLimit: number) =>
    countTotals(getFirestore(getApp(), "koryta-pl"), dailyLimit, new Date()),
  {
    name: OVERVIEW_CACHE,
    maxAge: 120,
    swr: false,
    getKey: (dailyLimit: number) => String(dailyLimit),
  },
);

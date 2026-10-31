import type { ActivityStats } from "~~/server/api/stats/activity.get";
import type { ActivityCounts } from "~~/shared/activity";

/** An answer of /api/stats/activity as far as folding needs it. `automatic`
 * may be missing: a server older than the field answers without it. */
type ActivityAnswer = {
  totals: ActivityCounts;
  total: number;
  automatic?: number;
  daily: {
    date: string;
    counts: ActivityCounts;
    total: number;
    automatic?: number;
  }[];
};

/** The activity as the pages add it up: what the declarations' automation
 * published on its own counted in „Opublikowane osoby”, as round
 * bip-autopublish-r1 picked. The endpoint keeps the two apart, so the ranking
 * and „od M osób” never see the automation; everything a page sums folds it
 * back in, so the tiles, the chart and the month's figure agree. */
export function foldAutomaticPublications(
  stats: ActivityAnswer,
): Pick<ActivityStats, "totals" | "total" | "daily"> {
  const automatic = stats.automatic ?? 0;
  return {
    totals: {
      ...stats.totals,
      publication: stats.totals.publication + automatic,
    },
    total: stats.total + automatic,
    daily: stats.daily.map((day) => {
      const thatDay = day.automatic ?? 0;
      return {
        ...day,
        counts: {
          ...day.counts,
          publication: day.counts.publication + thatDay,
        },
        total: day.total + thatDay,
        automatic: thatDay,
      };
    }),
  };
}

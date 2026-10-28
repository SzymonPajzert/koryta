import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineEventHandler, getQuery, setResponseHeader } from "h3";
import { z } from "zod";
import { daysBetween } from "~~/server/utils/activityStats";
import { requireOwner } from "~~/server/utils/auth";
import {
  RETENTION_DAYS,
  SEARCHES_COLLECTION,
  countSearchDays,
  summariseSearches,
  type SearchDay,
  type SearchQuerySummary,
  type StoredSearch,
} from "~~/shared/searchLog";
import { OPS_DATABASE } from "~~/shared/tasks";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most searches one answer reads. A few hundred a week is the traffic
 * today; past this the page says it is showing the newest ones only. */
const MAX_SEARCHES = 5000;

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(RETENTION_DAYS).default(30),
});

export type SearchesSummary = {
  days: number;
  /** Searches in the window. */
  total: number;
  /** Of those, by somebody not signed in. */
  signedOut: number;
  /** Whether the window held more than `MAX_SEARCHES`, so only the newest
   * are counted. */
  truncated: boolean;
  queries: SearchQuerySummary[];
  /** The window's searches by how they ended, a row per day from the first
   * day it holds a search to today. Empty when it holds none. */
  daily: SearchDay[];
};

/** The days to chart: from the oldest search read to today.
 *
 * Not from the window's first day, because the log is younger than the
 * longer windows: it went live on 2026-10-20, and weeks of zeros before that
 * would say nobody searched. When the answer stopped at `MAX_SEARCHES`, the
 * oldest day read is only partly counted, so the chart starts the day after.
 */
function chartedDays(
  searches: readonly StoredSearch[],
  truncated: boolean,
  today: string,
): string[] {
  const oldest = searches
    .map((search) => search.at.slice(0, 10))
    .reduce<string | undefined>(
      (min, day) => (min === undefined || day < min ? day : min),
      undefined,
    );
  if (!oldest) return [];
  const days = daysBetween(oldest, today);
  return truncated && days.length > 1 ? days.slice(1) : days;
}

/** What readers searched for over the last `days`, one row per query, and
 * how those searches ended day by day, for /admin/wyszukiwania.
 *
 * The last `days` UTC days, today among them, as /api/stats/activity counts
 * them: a window of whole days, so the chart's first column is not cut short
 * at the hour the page was opened.
 *
 * The owner only, like the task list: the queries are names - mostly people
 * the site already has, but also whoever else a reader thought to look for -
 * and the other administrators, trial ones included, have no need of them.
 */
export default defineEventHandler(async (event): Promise<SearchesSummary> => {
  await requireOwner(event);
  setResponseHeader(event, "Cache-Control", "no-store");
  const parsed = querySchema.safeParse(getQuery(event));
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: "Invalid days" });
  }
  const { days } = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const since = Date.parse(`${today}T00:00:00.000Z`) - (days - 1) * DAY_MS;

  const snapshot = await getFirestore(OPS_DATABASE)
    .collection(SEARCHES_COLLECTION)
    .where("at", ">=", Timestamp.fromMillis(since))
    .orderBy("at", "desc")
    .limit(MAX_SEARCHES)
    .get();

  const searches: StoredSearch[] = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      query: String(data.query ?? ""),
      results: Number(data.results ?? 0),
      unverified: Number(data.unverified ?? 0),
      outcome: data.outcome,
      ...(data.picked ? { picked: data.picked } : {}),
      ...(data.pickedUnverified ? { pickedUnverified: true } : {}),
      signedIn: data.signedIn === true,
      at:
        data.at instanceof Timestamp
          ? data.at.toDate().toISOString()
          : String(data.at ?? ""),
    };
  });

  const truncated = snapshot.size >= MAX_SEARCHES;
  return {
    days,
    total: searches.length,
    signedOut: searches.filter((search) => !search.signedIn).length,
    truncated,
    queries: summariseSearches(searches),
    daily: countSearchDays(searches, chartedDays(searches, truncated, today)),
  };
});

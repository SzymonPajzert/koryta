import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineEventHandler, getQuery, setResponseHeader } from "h3";
import { z } from "zod";
import { requireOwner } from "~~/server/utils/auth";
import {
  RETENTION_DAYS,
  SEARCHES_COLLECTION,
  summariseSearches,
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
};

/** What readers searched for over the last `days`, one row per query, for
 * /admin/wyszukiwania.
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

  const snapshot = await getFirestore(OPS_DATABASE)
    .collection(SEARCHES_COLLECTION)
    .where("at", ">=", Timestamp.fromMillis(Date.now() - days * DAY_MS))
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

  return {
    days,
    total: searches.length,
    signedOut: searches.filter((search) => !search.signedIn).length,
    truncated: snapshot.size >= MAX_SEARCHES,
    queries: summariseSearches(searches),
  };
});

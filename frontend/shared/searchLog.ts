/** What readers type into the search box, as the site keeps it for itself.
 *
 * Each settled search (`shared/searchSession.ts`) goes two places. Plausible
 * gets a logged out reader's as `search:settled`, to read beside the rest of
 * the visit. The site keeps everybody's here, in the ops database, read by
 * the owner alone (/admin/wyszukiwania): the names readers look for and the
 * site does not have, and the people it has and does not show, counted by how
 * often they are looked for - who to add or review next.
 *
 * Nothing about the reader goes with a search: no account, no address, only
 * whether somebody was signed in. And unlike what Plausible is sent, it does
 * not stay for good - a search is gone after `RETENTION_DAYS`, and one can be
 * deleted on its own.
 */

import type { SettledSearch } from "./searchSession";

/** The ops database collection the searches are kept in, one document per
 * settled search. Every document carries `expireAt`; a TTL policy on that
 * field deletes them (`RETENTION_DAYS`). */
export const SEARCHES_COLLECTION = "searchQueries";

/** How long a search is kept. Long enough to see a name come back week after
 * week; no longer, because a query is somebody's name and the list is only
 * worth what it says about now. */
export const RETENTION_DAYS = 180;

/** One settled search, as stored: what the box settled, plus whether somebody
 * was signed in (worked out by the server, not taken from the browser) and
 * when. */
export type StoredSearch = SettledSearch & {
  signedIn: boolean;
  /** ISO 8601. */
  at: string;
};

/** Everybody's searches for one query, over the window the page asked for. */
export type SearchQuerySummary = {
  query: string;
  /** Times it was searched. */
  count: number;
  /** Of those, by somebody not signed in. */
  signedOut: number;
  /** Times it found nothing at all. */
  noResults: number;
  /** Times everything it found was an unpublished person - for a logged out
   * reader, a list of teasers. */
  onlyUnverified: number;
  /** Times a result was opened. */
  picks: number;
  /** Times the reader offered to add what was missing instead. */
  proposes: number;
  /** ISO 8601, the latest time it was searched. */
  lastAt: string;
};

/** How a search ended, as /admin/wyszukiwania charts it: the reader opened
 * something it found, it found something and they opened none of it, or it
 * found nothing at all. Every search is exactly one of the three - the measure
 * of how well the search box serves the people who type into it.
 *
 * An offer to add what was missing counts by what the search had found: it
 * says the reader did not get what they came for, which is what the other two
 * failures say. A shortcut opened from the list („Lista wszystkich osób”, a
 * party) is a result opened, whatever the server answered. */
export const SEARCH_ENDINGS = ["opened", "notOpened", "nothing"] as const;
export type SearchEnding = (typeof SEARCH_ENDINGS)[number];

export type SearchEndingCounts = Record<SearchEnding, number>;

export function searchEnding(
  search: Pick<SettledSearch, "outcome" | "results">,
): SearchEnding {
  if (search.outcome === "pick") return "opened";
  return search.results > 0 ? "notOpened" : "nothing";
}

export function emptySearchEndingCounts(): SearchEndingCounts {
  return { opened: 0, notOpened: 0, nothing: 0 };
}

/** One day of searches, by how they ended. */
export type SearchDay = {
  /** The UTC day, `YYYY-MM-DD`, as /api/stats/activity counts its days. */
  date: string;
  all: SearchEndingCounts;
  /** Of those, by somebody not signed in. */
  signedOut: SearchEndingCounts;
};

/** The stored searches counted into `days`, one row per day in the order
 * given, so a day nobody searched on is a row of zeros rather than a gap. A
 * search on a day not in the list is left out. */
export function countSearchDays(
  searches: readonly StoredSearch[],
  days: readonly string[],
): SearchDay[] {
  const byDate = new Map(
    days.map((date) => [
      date,
      {
        date,
        all: emptySearchEndingCounts(),
        signedOut: emptySearchEndingCounts(),
      },
    ]),
  );
  for (const search of searches) {
    const day = byDate.get(search.at.slice(0, 10));
    if (!day) continue;
    const ending = searchEnding(search);
    day.all[ending] += 1;
    if (!search.signedIn) day.signedOut[ending] += 1;
  }
  return [...byDate.values()];
}

/** A column of the chart: one day, or the days of one week. */
export type SearchPeriod = SearchDay & {
  /** The last day it covers, `YYYY-MM-DD`; `date` is the first. */
  last: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday of the week `date` falls in, weeks running Monday to Sunday as
 * they do in Poland. */
function mondayOf(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The days, oldest first, added up into weeks. A week covers only the days
 * it was given, so the window's first week starts on its first day and this
 * week ends today - its `date` and `last` say which days went into it. */
export function searchWeeks(days: readonly SearchDay[]): SearchPeriod[] {
  const weeks = new Map<string, SearchPeriod>();
  for (const day of days) {
    const monday = mondayOf(day.date);
    const week = weeks.get(monday);
    if (!week) {
      weeks.set(monday, {
        date: day.date,
        last: day.date,
        all: { ...day.all },
        signedOut: { ...day.signedOut },
      });
      continue;
    }
    week.last = day.date;
    for (const ending of SEARCH_ENDINGS) {
      week.all[ending] += day.all[ending];
      week.signedOut[ending] += day.signedOut[ending];
    }
  }
  return [...weeks.values()];
}

/** The stored searches, one row per query, most searched first; ties go to the
 * most recent. */
export function summariseSearches(
  searches: readonly StoredSearch[],
): SearchQuerySummary[] {
  const byQuery = new Map<string, SearchQuerySummary>();
  for (const search of searches) {
    const row = byQuery.get(search.query) ?? {
      query: search.query,
      count: 0,
      signedOut: 0,
      noResults: 0,
      onlyUnverified: 0,
      picks: 0,
      proposes: 0,
      lastAt: search.at,
    };
    row.count += 1;
    if (!search.signedIn) row.signedOut += 1;
    if (search.results === 0) row.noResults += 1;
    if (search.results > 0 && search.unverified >= search.results) {
      row.onlyUnverified += 1;
    }
    if (search.outcome === "pick") row.picks += 1;
    if (search.outcome === "propose") row.proposes += 1;
    if (search.at > row.lastAt) row.lastAt = search.at;
    byQuery.set(search.query, row);
  }
  return [...byQuery.values()].sort(
    (a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt),
  );
}

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

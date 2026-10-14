/** What a reader searched for, once per search, for `search:settled`.
 *
 * ## Why the query goes to Plausible
 *
 * Everywhere else the vocabulary keeps free text out of analytics (see
 * `shared/analytics.ts`), and a query is somebody's name. We save
 * which names readers look for and do not find, or find only as
 * an unpublished person, is the most direct list there is of
 * whom to add or review next, and it reads best beside the rest of the visit -
 * the pick, the teaser, the sign-in. Only a logged out reader's searches are
 * sent: those are the readers the question is about, and a contributor's
 * searches are their research.
 *
 * Plausible keeps what it is sent and cannot drop one entry, so if that turns
 * out to matter - somebody asks for their name to be taken out, say - the
 * version that keeps the queries in the ops database instead, deletable and
 * gone after 180 days with a page of its own, is on the branch
 * `first-party-search-log`.
 *
 * ## One event per search, not per keystroke
 *
 * The box asks the server as the reader types - "jan", "jan kow", "jan
 * kowalski" - and every one of those is a query, but only the last is a
 * search. `SearchSession` keeps the latest query that came back and hands it
 * over once it is settled: the reader opened a result, offered to add what was
 * not found, or left the box. Typing on, or deleting back, is the same search;
 * a query that neither extends nor shortens the previous one is a new search,
 * and the previous one is settled as left.
 */

import { resultBucket, unverifiedShare } from "./analytics";

/** The longest query sent. A name, even a company's in full, fits; anything
 * longer is not a search. */
export const MAX_QUERY_LENGTH = 100;

/** The shortest query sent. Two letters are a reader still typing. */
export const MIN_QUERY_LENGTH = 3;

/** How a search ended: a result opened, something offered to be added, or the
 * box left without either. */
export type SearchOutcome = "pick" | "propose" | "abandon";

/** One settled search. */
export type SettledSearch = {
  /** As `normaliseQuery` leaves it. */
  query: string;
  /** How many hits the server answered with. */
  results: number;
  /** Of those, how many were people nobody has published. */
  unverified: number;
  outcome: SearchOutcome;
};

/** A query as it is compared and sent: lowercased, whitespace collapsed,
 * capped. Case and spacing are how it was typed, not what was asked, and two
 * spellings of one name would split its count in two. */
export function normaliseQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/** Whether `next` is the same search as `previous`, typed on or deleted back. */
function sameSearch(previous: string, next: string): boolean {
  return previous.startsWith(next) || next.startsWith(previous);
}

type Pending = Omit<SettledSearch, "outcome">;

/** The search box's searches, settled one at a time. Each method returns the
 * search to report, if what happened settled one. */
export class SearchSession {
  private pending: Pending | undefined;

  /** The answer to `query` arrived. Settles the previous search as left when
   * this is a different one. */
  results(
    query: string,
    results: number,
    unverified: number,
  ): SettledSearch | undefined {
    const normalised = normaliseQuery(query);
    const previous = this.pending;
    this.pending = { query: normalised, results, unverified };
    if (!previous || sameSearch(previous.query, normalised)) return undefined;
    return settled(previous, "abandon");
  }

  /** The reader opened a result. */
  pick(): SettledSearch | undefined {
    return this.settle("pick");
  }

  /** The reader offered to add what the search did not find. */
  propose(): SettledSearch | undefined {
    return this.settle("propose");
  }

  /** The reader left the box - cleared it, went to another page, hid the
   * tab - without taking anything. */
  abandon(): SettledSearch | undefined {
    return this.settle("abandon");
  }

  private settle(outcome: SearchOutcome): SettledSearch | undefined {
    const pending = this.pending;
    this.pending = undefined;
    return pending ? settled(pending, outcome) : undefined;
  }
}

function settled(
  pending: Pending,
  outcome: SearchOutcome,
): SettledSearch | undefined {
  if (pending.query.length < MIN_QUERY_LENGTH) return undefined;
  return { ...pending, outcome };
}

/** `search:settled`'s properties: the query as it is, and the counts bucketed
 * the way `search:performed` buckets them, so the two break down alike. */
export function settledSearchProps(search: SettledSearch): {
  query: string;
  results: string;
  unverified: string;
  outcome: SearchOutcome;
} {
  return {
    query: search.query,
    results: resultBucket(search.results),
    unverified: unverifiedShare(search.results, search.unverified),
    outcome: search.outcome,
  };
}

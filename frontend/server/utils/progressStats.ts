/* eslint-disable @typescript-eslint/no-explicit-any */

/** The tagging-progress counters, and the two ways of arriving at them.
 *
 * `/api/stats/progress` computes these twice over: by reading every person and
 * counting in memory, and - when no filter narrows the set - by asking
 * Firestore for four aggregations instead. Both live here, as functions over
 * plain data, so that a test can assert the cheap one agrees with the
 * expensive one rather than trusting the arithmetic by eye.
 */

export type ProgressStats = {
  /** People matching the structural filters, regardless of status. */
  total: number;
  /** Published (approved) people. */
  approved: number;
  /** Not published yet, but already looked at: voted on or annotated.
   *
   * Deliberately not "or has a revision waiting for approval". Every person
   * the scrapers ingest arrives as an unapproved revision, so
   * `revisions.has_unapproved` is set on all 5190 unpublished people and on
   * none of the published ones - counting it would restate `toCheck` under a
   * second name. Only 30 of those 5190 have a hand-written latest revision,
   * and telling them apart costs a read of every one of the revisions. If
   * that number is ever wanted, /api/admin/summary already computes it as
   * `unapprovedManual`. */
  reviewed: number;
  /** Not published and untouched by the community. */
  toCheck: number;
  /** People at least one human voted on. */
  withVotes: number;
  /** People with at least one note. */
  withNotes: number;
};

export const zeroProgress: ProgressStats = {
  total: 0,
  approved: 0,
  reviewed: 0,
  toCheck: 0,
  withVotes: 0,
  withNotes: 0,
};

/** The counters, from the documents themselves. */
export function scanProgress(nodes: any[]): ProgressStats {
  const stats = { ...zeroProgress, total: nodes.length };
  for (const node of nodes) {
    const isApproved = node.stats?.isApproved === true;
    const hasVotes = node.stats?.votes?.humanVoted === true;
    const hasNotes = (node.stats?.notesCount ?? 0) > 0;

    if (isApproved) stats.approved++;
    else if (hasVotes || hasNotes) stats.reviewed++;
    else stats.toCheck++;

    if (hasVotes) stats.withVotes++;
    if (hasNotes) stats.withNotes++;
  }
  return stats;
}

/** What Firestore can be asked for without reading a person document. */
export type ProgressCounts = {
  /** `count(type == person)`. */
  total: number;
  /** `count(type == person && stats.isApproved == true)`. */
  approved: number;
  /** `count(type == person && stats.votes.humanVoted == true)`. */
  voted: number;
  /** The two above together, so that the voted-but-unapproved people can be
   * had by subtraction rather than by asking for `isApproved == false`, which
   * would silently drop every person who has no such field. */
  votedAndApproved: number;
  /** One row per person carrying a note, read rather than counted: there are
   * a few hundred, against four more aggregations and four more composite
   * indexes to get the same three numbers out of them. */
  noted: { isApproved: boolean; humanVoted: boolean }[];
};

/** The same counters as `scanProgress`, from aggregations.
 *
 * `reviewed` is the unapproved people somebody has looked at, which is the
 * voted-on ones plus the ones only a note reached - split that way, rather
 * than as a union, so that a person with both is not counted twice.
 */
export function combineProgressCounts(counts: ProgressCounts): ProgressStats {
  const notedOnly = counts.noted.filter(
    (row) => !row.isApproved && !row.humanVoted,
  ).length;
  const reviewed = counts.voted - counts.votedAndApproved + notedOnly;

  return {
    total: counts.total,
    approved: counts.approved,
    reviewed,
    toCheck: counts.total - counts.approved - reviewed,
    withVotes: counts.voted,
    withNotes: counts.noted.length,
  };
}

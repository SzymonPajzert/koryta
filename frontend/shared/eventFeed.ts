/** Merging several streams of dated events into the one feed the home page
 * draws.
 *
 * The home page used to be a list of employments and nothing else, which made
 * its order the endpoint's problem: one Firestore query, `start_date`
 * descending, paged by a cursor. It is now a feed of *events* - a post taken
 * up, a round number of years served, and whatever gets found next - and those
 * come from different endpoints with different shapes and different costs.
 * Merging them server side would mean one query that cannot exist; merging
 * them here costs a comparison per card.
 *
 * The vocabulary is deliberately thin: a spine and its guests. The spine is
 * the stream that pages - it is what the infinite scroll asks for more of, and
 * so what decides how far back the feed currently reaches. A guest is a
 * bounded stream fetched whole, small enough that there is no cursor to keep.
 * Adding a third kind of card means adding to the guests, not to this file.
 */

/** The least a card has to say about itself to take its place in the feed. */
export type DatedEvent = {
  /** Unique across every stream in the feed, because it keys one `v-for` over
   * all of them. Prefix it with the stream - two ids from two collections can
   * collide, and Vue would then reuse the wrong component for it. */
  key: string;
  /** The ISO day the event happened on, `YYYY-MM-DD`.
   *
   * Compared as a string rather than parsed, which is the whole reason the
   * feed speaks in ISO days: a lexicographic compare on that format is the
   * chronological one, and no `Date` means no timezone to get wrong. */
  date: string;
};

/** Newest first, with ties broken on the key so the order is total.
 *
 * A tie is two events on one day, and there is nothing left to rank them by -
 * but "nothing to rank them by" must not mean "whatever order they arrived
 * in", or a refetch that returns the same events could draw them differently
 * and Vue would animate a feed nobody changed.
 */
function newestFirst(a: DatedEvent, b: DatedEvent): number {
  return b.date.localeCompare(a.date) || a.key.localeCompare(b.key);
}

/** The two streams as one feed, newest first.
 *
 * A guest is drawn *before* the spine events of its own day. Both readings are
 * defensible - it is the same day either way - and this one puts the card that
 * is unusual at the top of the day rather than buried under however many
 * appointments a KRS batch happened to file that morning.
 *
 * Guests older than the last spine event are held back until `spineExhausted`,
 * and that is the one rule here worth stating twice. The spine grows downwards
 * as the reader scrolls: whatever is at the bottom of the feed now has more
 * arriving underneath it. A guest drawn past the end of the spine would
 * therefore be correct for one moment and wrong for the next, and the fix is
 * not a re-sort - it is that the card would visibly jump *up* the page while
 * somebody was reading it. Held back, a guest only ever appears where it will
 * stay.
 *
 * `spine` is taken in the order it was given. It is a paged stream and its
 * order is the endpoint's, cursor and all; re-sorting it here would paper over
 * a feed whose pages do not line up rather than let it be noticed.
 */
export function interleaveByDate<T extends DatedEvent>(
  spine: readonly T[],
  guests: readonly T[],
  { spineExhausted }: { spineExhausted: boolean },
): T[] {
  // Sorted here rather than at the call site because there may be several
  // guest streams and they arrive as separate responses, so somebody has to
  // put them in one order - and this is the only place that knows what order
  // the feed is in.
  const pending = [...guests].sort(newestFirst);

  const feed: T[] = [];
  let next = 0;
  for (const event of spine) {
    while (next < pending.length && pending[next]!.date >= event.date) {
      feed.push(pending[next]!);
      next += 1;
    }
    feed.push(event);
  }

  if (spineExhausted) {
    for (; next < pending.length; next += 1) feed.push(pending[next]!);
  }
  return feed;
}

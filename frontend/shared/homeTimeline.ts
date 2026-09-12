/** One post somebody held, reduced to what a timeline counts: who, under which
 * groups, between which two months.
 *
 * `groups` is whatever dimension is being drawn - the parties a person is filed
 * under, the województwo their employer sits in, the sectors it is filed under.
 * They travel with the post rather than being looked up later, because the
 * caller is the only side that knows how to read them: a node written through
 * `sanitizeFirestoreData` stores `parties` and `categories` as numbered-key
 * objects, so both have to go through `asArray` before they reach here.
 */
export type HeldPost = {
  personId: string;
  /** Every group this post counts towards. De-duplicated here, so a caller may
   * fold `["SLD", "Nowa Lewica"]` to one canonical name and pass it twice. */
  groups: string[];
  /** ISO day the post began. A post with no start date cannot be placed on a
   * timeline at all and is the caller's to drop. */
  start: string;
  /** ISO day it ended, or null for one still held. */
  end: string | null;
};

export type TimelineSeries = {
  /** The group's own key - a party name, a województwo's TERYT, a category
   * slug. `OTHER_KEY` for the folded remainder. */
  key: string;
  /** What to call it on the legend. */
  label: string;
  /** One count per month in `months`, same index. */
  counts: number[];
};

export type Timeline = {
  /** Every month the series covers, `YYYY-MM`, oldest first and with no gaps. */
  months: string[];
  /** One line per group, ordered by how high the line ever reaches so that the
   * legend reads top-down in the order the chart does. */
  series: TimelineSeries[];
};

/** The key the folded remainder is returned under. Not a value any dimension
 * could produce: a TERYT code is digits, and a party name and a category slug
 * are neither empty nor punctuation. */
export const OTHER_KEY = "__other__";

/** How many lines a chart may carry.
 *
 * Eight is the categorical palette's length, and the palette's *order* is the
 * colourblind-safety mechanism - a ninth series would be a hue picked to suit
 * rather than one the validator has passed against its neighbours. Sixteen
 * województwa and nine sectors both run past it, so the tail folds into one
 * „pozostałe” line rather than being dropped or recoloured. See
 * `app/utils/chartTheme.ts`.
 */
export const MAX_SERIES = 8;

/** End dates that are a crawl stamp rather than the day a post ended.
 *
 * 205 published `employed` edges - across 201 distinct institutions - carry
 * `end_date: 2026-03-18`. Nobody vacated 201 boards on a Wednesday: an ingest
 * run on that day closed every post it could no longer see in the register, so
 * the date says when we looked, not when they left. 135 of those posts had
 * begun in 2024 or 2025.
 *
 * Counted literally it costs the chart 149 people in one step - 365 down to
 * 216 - four months from the right-hand edge, which is the part of the picture
 * a reader trusts most. So a post closed on one of these days is counted as
 * still held, which is the weaker of the two wrong answers: the post is at
 * worst over-counted from its true end until today, against a cliff that never
 * happened. The subtitle on the chart says the recent months are provisional.
 *
 * This is a plaster over an ingest bug and should come off when the bug is
 * fixed - `_employment_changes` in `data/pipelines/src/analysis/payloads/site.py`
 * writes whatever `end` the upstream payload carries, so the date is decided
 * before it reaches the site.
 */
export const CRAWL_STAMP_END_DATES: ReadonlySet<string> = new Set([
  "2026-03-18",
]);

/** The end date to count a post by: null - still held - where the stored one is
 * a crawl stamp. */
export function effectiveEnd(end: string | null | undefined): string | null {
  if (typeof end !== "string" || end === "") return null;
  const day = end.slice(0, 10);
  return CRAWL_STAMP_END_DATES.has(day) ? null : end;
}

/** `YYYY-MM` as a count of months, so two of them can be compared and stepped
 * between by arithmetic. Null for anything that is not a date. */
export function monthIndex(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.length < 7) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/** The inverse: a month count back to `YYYY-MM`. */
export function monthKey(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

type Span = { from: number; to: number };

/** Merges a person's spans so that two posts held at once count as one person.
 *
 * Both ends inclusive, in month units; two spans overlapping or merely touching
 * become one. The usual interval merge, spelled out here because the counts
 * downstream are only distinct-people counts if it is right. */
function mergeMonthSpans(spans: Span[]): Span[] {
  if (spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    // `last.to + 1`, not `last.to`: January-to-March and April-to-June are one
    // unbroken stretch, not two, and counting the person twice in the month
    // they run into would be the one thing this function exists to stop.
    if (last && span.from <= last.to + 1) {
      if (span.to > last.to) last.to = span.to;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** How many distinct people were in post each month, for one group.
 *
 * A difference array rather than a set per month: the spans are merged and so
 * disjoint, which makes +1 at the first month and -1 after the last, summed,
 * the distinct-person count - one pass instead of one set insert per person
 * per month.
 */
function countsFor(
  people: Map<string, Span[]>,
  firstMonth: number,
  width: number,
): number[] {
  // One longer than the window, so a span reaching the last month can close
  // itself at `to + 1` without a bounds check.
  const delta = new Array<number>(width + 1).fill(0);
  for (const spans of people.values()) {
    for (const span of mergeMonthSpans(spans)) {
      delta[span.from - firstMonth]! += 1;
      delta[span.to - firstMonth + 1]! -= 1;
    }
  }

  const counts: number[] = [];
  let running = 0;
  for (let i = 0; i < width; i += 1) {
    running += delta[i]!;
    counts.push(running);
  }
  return counts;
}

/** How many distinct people held a post in each month, one line per group.
 *
 * *People*, not posts: somebody sitting on three boards at once is one person
 * in that month, which is why each person's spans are merged before anything
 * is counted. Somebody who matches two groups is counted under both - there is
 * no way to pick which of a person's two parties got them the seat, and a
 * career spanning two województwa belongs to both - so the lines do not add up
 * to a headcount and the chart must not stack them.
 *
 * The series runs from the earliest month anything is known about to `today`.
 * Its left-hand end is thin because the database is thin there, not because
 * fewer people held posts in 2003; the chart says so in its subtitle.
 */
export function buildTimeline(
  posts: HeldPost[],
  today: string,
  options: {
    /** What to call a group on the legend. Defaults to the key itself. */
    labelOf?: (key: string) => string;
    /** What to call the folded remainder, when there is one. */
    otherLabel?: string;
    /** How many lines to return, the „pozostałe” one included. */
    maxSeries?: number;
    /** Force the axis to open on this month (`YYYY-MM` or an ISO day) rather
     * than on the first one this group of posts reaches.
     *
     * What it is for: three groupings drawn from the same posts do not all
     * begin in the same month - a sector was first filed in 2004, a party in
     * 2001 - and lines of different lengths cannot share one axis. The caller
     * passes the earliest month any of them reaches, so switching the grouping
     * moves the lines rather than the years under them. Ignored if it falls
     * after the first month in `posts`, which would cut data off the front. */
    from?: string;
  } = {},
): Timeline {
  const lastMonth = monthIndex(today);
  if (lastMonth === null) return { months: [], series: [] };

  const labelOf = options.labelOf ?? ((key: string) => key);
  const maxSeries = options.maxSeries ?? MAX_SERIES;

  // group -> person -> the months they held something
  const byGroup = new Map<string, Map<string, Span[]>>();
  let firstMonth: number | null = null;

  for (const post of posts) {
    const from = monthIndex(post.start);
    if (from === null || from > lastMonth) continue;
    const rawTo = monthIndex(post.end);
    // An end before the start is a typo somewhere upstream, not a post held
    // backwards; treat it as a post that lasted the month it began.
    const to = Math.min(
      rawTo === null ? lastMonth : Math.max(rawTo, from),
      lastMonth,
    );

    firstMonth = firstMonth === null ? from : Math.min(firstMonth, from);

    for (const group of new Set(post.groups)) {
      let people = byGroup.get(group);
      if (!people) byGroup.set(group, (people = new Map()));
      const spans = people.get(post.personId);
      if (spans) spans.push({ from, to });
      else people.set(post.personId, [{ from, to }]);
    }
  }

  if (firstMonth === null) return { months: [], series: [] };

  const forced = monthIndex(options.from);
  if (forced !== null && forced < firstMonth) firstMonth = forced;

  const months: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m += 1) months.push(monthKey(m));
  const width = months.length;

  let ranked: (TimelineSeries & { peak: number })[] = [];
  for (const [key, people] of byGroup) {
    const counts = countsFor(people, firstMonth, width);
    const peak = Math.max(...counts);
    // A group nobody in the data belongs to would be an empty line across the
    // whole chart. It cannot happen from the loop above - a group only gets a
    // map by having a post - but a caller passing an empty `groups` could.
    if (peak > 0) ranked.push({ key, label: labelOf(key), counts, peak });
  }

  // Tallest line first, so the legend and the chart read in the same order.
  // By the peak rather than by today's value: a party out of office now still
  // belongs where its story is, and reordering the legend every month as two
  // groups trade fourth place would be worse than either.
  ranked.sort((a, b) => b.peak - a.peak || a.key.localeCompare(b.key, "pl"));

  if (ranked.length > maxSeries) {
    const kept = ranked.slice(0, maxSeries - 1);
    const folded = ranked.slice(maxSeries - 1);

    // Re-counted from the folded groups' own spans rather than summed from
    // their lines. Summing would count somebody who is in two of the folded
    // groups twice in „pozostałe” - exactly the double counting the span merge
    // exists to prevent, and the tail is where it is most likely, being the
    // longest list.
    const people = new Map<string, Span[]>();
    for (const line of folded) {
      for (const [personId, spans] of byGroup.get(line.key)!) {
        const held = people.get(personId);
        if (held) held.push(...spans);
        else people.set(personId, [...spans]);
      }
    }

    const counts = countsFor(people, firstMonth, width);
    ranked = [
      ...kept,
      {
        key: OTHER_KEY,
        label: options.otherLabel ?? "Pozostałe",
        counts,
        peak: Math.max(...counts),
      },
    ];
  }

  return {
    months,
    // `peak` was scaffolding for the ordering and the fold; it is not part of
    // the answer, and every count it could be read off is in `counts`.
    series: ranked.map(({ key, label, counts }) => ({ key, label, counts })),
  };
}

import { canonicalParty } from "./misc";

/** One post somebody held, reduced to what the timeline counts: who, under
 * which party labels, between which two months.
 *
 * The party labels travel with the post rather than being looked up later,
 * because the caller is the only side that knows how to read them - a node
 * written through `sanitizeFirestoreData` stores `parties` as a numbered-key
 * object, so it has to go through `asArray` before it reaches here. */
export type HeldPost = {
  personId: string;
  /** Every party the person is filed under, as stored. Folded to canonical
   * names and de-duplicated here, so `["SLD", "Nowa Lewica"]` is one party. */
  parties: string[];
  /** ISO day the post began. A post with no start date cannot be placed on a
   * timeline at all and is the caller's to drop. */
  start: string;
  /** ISO day it ended, or null for one still held. */
  end: string | null;
};

export type PartySeries = {
  /** The canonical party name, which is also the key into `partyColors`. */
  party: string;
  /** One count per month in `months`, same index. */
  counts: number[];
};

export type PartyTimeline = {
  /** Every month the series covers, `YYYY-MM`, oldest first and with no gaps. */
  months: string[];
  /** One line per party, ordered by how high the line ever reaches so that the
   * legend reads top-down in the order the chart does. */
  series: PartySeries[];
};

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

/** Merges a person's spans so that two posts held at once count as one person.
 *
 * Half-open on the right in month units: `[from, to]` are both inclusive month
 * indexes, and two spans touching or overlapping become one. Sorted by start,
 * then walked - the usual interval merge, spelled out here because the counts
 * downstream are only distinct-people counts if it is right. */
function mergeMonthSpans(
  spans: { from: number; to: number }[],
): { from: number; to: number }[] {
  if (spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    // `span.from - 1` rather than `span.from`: January-to-March and April-to-June
    // are one unbroken stretch, not two, and counting the person twice in the
    // month they run into would be the one thing this function exists to stop.
    if (last && span.from <= last.to + 1) {
      if (span.to > last.to) last.to = span.to;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** How many distinct people held a post in each month, one line per party.
 *
 * *People*, not posts: somebody sitting on three boards at once is one person
 * in that month, which is why each person's spans are merged before anything is
 * counted. Somebody filed under two parties is counted under both - there is no
 * way to pick which affiliation got them the seat, and 201 of the 2,158 people
 * with a party carry more than one - so the lines do not add up to a headcount
 * and the chart must not stack them.
 *
 * The series runs from the earliest month anything is known about to `today`.
 * Its left-hand end is thin because the database is thin there, not because
 * fewer people held posts in 2003; the chart says so in its subtitle.
 *
 * Counted with a difference array per party rather than a set per month: the
 * spans are merged and so disjoint, so +1 at the first month and -1 after the
 * last, summed, is the distinct-person count - one pass instead of one set
 * insert per person per month.
 */
export function buildPartyTimeline(
  posts: HeldPost[],
  today: string,
): PartyTimeline {
  const lastMonth = monthIndex(today);
  if (lastMonth === null) return { months: [], series: [] };

  // party -> person -> the months they held something
  const byParty = new Map<
    string,
    Map<string, { from: number; to: number }[]>
  >();
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

    const parties = new Set(post.parties.map(canonicalParty));
    for (const party of parties) {
      let people = byParty.get(party);
      if (!people) byParty.set(party, (people = new Map()));
      const spans = people.get(post.personId);
      if (spans) spans.push({ from, to });
      else people.set(post.personId, [{ from, to }]);
    }
  }

  if (firstMonth === null) return { months: [], series: [] };

  const months: string[] = [];
  for (let m = firstMonth; m <= lastMonth; m += 1) months.push(monthKey(m));
  const width = months.length;

  const series: PartySeries[] = [];
  for (const [party, people] of byParty) {
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
    // A party nobody in the data belongs to would be an empty line across the
    // whole chart. It cannot happen from the loop above - a party only gets a
    // map by having a post - but a caller passing an empty `parties` could.
    if (counts.some((count) => count > 0)) series.push({ party, counts });
  }

  // Tallest line first, so the legend and the chart read in the same order.
  // By the peak rather than by today's value: a party out of office now still
  // belongs where its story is, and reordering the legend every month as two
  // parties trade fourth place would be worse than either.
  series.sort(
    (a, b) =>
      Math.max(...b.counts) - Math.max(...a.counts) ||
      a.party.localeCompare(b.party, "pl"),
  );

  return { months, series };
}

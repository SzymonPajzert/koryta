import type { Firestore } from "firebase-admin/firestore";
import {
  activityKinds,
  emptyActivityCounts,
  totalActivity,
  type ActivityCounts,
  type ActivityKind,
} from "~~/shared/activity";
import {
  aggregateActivity,
  utcDay,
  type ActivityAggregate,
  type ActivityEvent,
} from "~~/server/utils/activityStats";
import { collectActivityEvents } from "~~/server/utils/activityEvents";

/** One finished UTC day of activity, counted once and kept.
 *
 * The activity section used to answer every request by scanning every source
 * collection across the whole window - up to 20,000 documents per collection,
 * per window length, re-read every time the five-minute cache lapsed. Almost
 * all of that is settled history: what happened on the 3rd cannot change on the
 * 12th, so it is counted on the 4th and read back as a single document from
 * then on. A 90-day window is 89 document reads plus one scan of today.
 *
 * The exception is worth stating, because it is the one way a stored day can
 * drift from a live count. Votes and notes are edited in place and carry only
 * the time of the *last* edit, so re-voting on a person you rated last week
 * moves that event onto today - and the stored rollup for last week still
 * counts it where it was. The same document then shows up on both days. The
 * live scan this replaces had the opposite bug (the older day silently lost the
 * event), and neither is fixable without recording an event per write rather
 * than reading it off the mutable document. Revisions and audit entries are
 * append-only and never drift.
 */
export type DailyRollup = {
  /** `YYYY-MM-DD`, UTC. Also the document id. */
  date: string;
  totals: ActivityCounts;
  /** Per contributor, for the day. Pipeline and migration uids are already
   * filtered out by `aggregateActivity`, so nothing in here is a robot. */
  contributors: Record<
    string,
    { counts: ActivityCounts; lastActiveAt: string }
  >;
  /** Kinds whose scan hit its cap on this day, so the day is a lower bound. */
  truncated: ActivityKind[];
};

/** Bumped whenever the rule for what counts as activity changes.
 *
 * A stored day was counted under the rule that was current when it was written,
 * so a change of rule has to invalidate it - otherwise the ingest revisions
 * this version stopped counting would stay in every day already on disk, and
 * the fix would only apply going forward. A day whose document carries a
 * different version is recomputed and overwritten.
 *
 * 1: excludes automatic revisions and article-node bookkeeping.
 * 2: excludes the `migration:*` scripts as well as the pipeline.
 * 3: four kinds instead of seven — the two vote kinds merged, comments and
 *    non-publication admin decisions dropped. A day stored under 2 holds its
 *    counts under names this version no longer reads, so it would come back as
 *    a day on which nobody voted.
 */
const ROLLUP_VERSION = 3;

const COLLECTION = "activityDaily";

/** How long a day is left alone after it ends before its count is written down.
 *
 * A day is settled when nothing can still land in it, and "midnight has passed"
 * is not quite that. Votes are stamped in the browser
 * (`app/composables/votes.ts` writes `new Date().toISOString()`), so a machine
 * whose clock is behind writes an event dated earlier than the moment it
 * happened - and if that lands after the day it claims has been stored, it is
 * lost, because the stored day is never counted again.
 *
 * Six hours buys tolerance of that at the cost of scanning at most one extra
 * day live. It bounds the skew that is survivable rather than eliminating it: a
 * clock a week out still writes into a day nobody will recount. Every other
 * timestamp here is written by the server and cannot drift at all.
 */
const SETTLE_HOURS = 6;

/** Split a window's days into the ones worth storing and the ones still worth
 * reading live. `live` is always the suffix, because a later day settles later,
 * and it always holds today. */
export function splitSettledDays(
  days: string[],
  now: Date,
): { settled: string[]; live: string[] } {
  const cutoff = now.getTime() - SETTLE_HOURS * 60 * 60 * 1000;
  const first = days.findIndex((day) => Date.parse(dayEndIso(day)) > cutoff);
  return first === -1
    ? { settled: days, live: [] }
    : { settled: days.slice(0, first), live: days.slice(first) };
}

/** How many days one catch-up scan covers.
 *
 * Missing days are read in ranges rather than one query per day: a cold start
 * on a 90-day window would otherwise be 540 round trips for exactly the
 * documents a single windowed scan already returns. Seven keeps a range well
 * inside the per-collection scan cap on any plausible day, and a range that
 * does hit the cap is redone day by day so the cap applies per day instead. */
const RANGE_DAYS = 7;

/** Ranges built at once. Enough to make a cold 90-day start a handful of
 * waves, low enough not to open thirty-nine concurrent Firestore scans. */
const RANGE_CONCURRENCY = 3;

/** Firestore's per-batch write limit is 500; this leaves room to spare. */
const WRITE_BATCH = 400;

export function dayStartIso(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** The instant the day ends, as an exclusive upper bound. */
export function dayEndIso(day: string): string {
  return new Date(
    Date.parse(dayStartIso(day)) + 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** Roll one day's events up into the document that will stand for it.
 *
 * Goes through `aggregateActivity` rather than counting here, so a stored day
 * and a live one are produced by the same code - including which uids are
 * dropped as robots and how a note's several sources are counted.
 */
export function rollupForDay(
  date: string,
  events: ActivityEvent[],
  truncated: ActivityKind[],
): DailyRollup {
  const aggregate = aggregateActivity(events, { since: date, until: date });

  return {
    date,
    totals: aggregate.totals,
    contributors: Object.fromEntries(
      aggregate.contributors.map((c) => [
        c.uid,
        { counts: c.counts, lastActiveAt: c.lastActiveAt },
      ]),
    ),
    truncated: [...new Set(truncated)],
  };
}

/** Assemble a window's aggregate out of the days it spans.
 *
 * Same shape `aggregateActivity` returns for a live scan, so the endpoint and
 * everything below it cannot tell which of the two it was handed. `days` is
 * what fixes the window: a day with no rollup is a zero column rather than a
 * gap, exactly as it is when the scan found nothing.
 */
export function mergeRollups(
  days: string[],
  rollups: Iterable<DailyRollup>,
): ActivityAggregate {
  const byDate = new Map<string, DailyRollup>();
  for (const rollup of rollups) byDate.set(rollup.date, rollup);

  const totals = emptyActivityCounts();
  const byUid = new Map<
    string,
    { uid: string; counts: ActivityCounts; total: number; lastActiveAt: string }
  >();

  const daily = days.map((date) => {
    const rollup = byDate.get(date);
    const counts = rollup ? { ...rollup.totals } : emptyActivityCounts();

    for (const kind of activityKinds) totals[kind] += counts[kind];

    for (const [uid, entry] of Object.entries(rollup?.contributors ?? {})) {
      let contributor = byUid.get(uid);
      if (!contributor) {
        contributor = {
          uid,
          counts: emptyActivityCounts(),
          total: 0,
          lastActiveAt: entry.lastActiveAt,
        };
        byUid.set(uid, contributor);
      }
      for (const kind of activityKinds) {
        contributor.counts[kind] += entry.counts[kind];
      }
      contributor.total = totalActivity(contributor.counts);
      if (entry.lastActiveAt > contributor.lastActiveAt) {
        contributor.lastActiveAt = entry.lastActiveAt;
      }
    }

    return { date, counts, total: totalActivity(counts) };
  });

  return {
    totals,
    total: totalActivity(totals),
    daily,
    // Same tie-break as a live aggregate, so two windows that hold the same
    // work rank it the same way.
    contributors: [...byUid.values()].sort(
      (a, b) => b.total - a.total || (a.uid < b.uid ? -1 : 1),
    ),
  };
}

/** Every kind that any day in the set reported as cut short. */
export function mergeTruncated(rollups: Iterable<DailyRollup>): ActivityKind[] {
  const kinds = new Set<ActivityKind>();
  for (const rollup of rollups)
    for (const kind of rollup.truncated) kinds.add(kind);
  return [...kinds];
}

/** The rollup for every day in `days`, computing and storing the ones that are
 * missing or were written under an older counting rule.
 *
 * Only ever called for *settled* days - see `splitSettledDays`. Today has not
 * stopped happening, so it is scanned live by the caller and never written here:
 * a stored "today" would freeze the page at whatever the first reader of the
 * morning saw.
 *
 * Storing is best effort. If the write fails the computed value is still
 * returned, so a credentials or rules problem degrades to "recounts every time"
 * - which is what the page did before this existed - rather than to a 500.
 */
export async function ensureDailyRollups(
  db: Firestore,
  days: string[],
): Promise<DailyRollup[]> {
  if (days.length === 0) return [];

  const stored = await readRollups(db, days);
  const missing = days.filter((day) => !stored.has(day));
  if (missing.length === 0) return days.map((day) => stored.get(day)!);

  console.info(
    `activityDaily: computing ${missing.length} of ${days.length} days ` +
      `(${missing[0]}..${missing[missing.length - 1]})`,
  );

  const computed: DailyRollup[] = [];
  const ranges = chunkContiguous(missing, RANGE_DAYS);
  for (let i = 0; i < ranges.length; i += RANGE_CONCURRENCY) {
    const wave = ranges.slice(i, i + RANGE_CONCURRENCY);
    const results = await Promise.all(
      wave.map((range) => buildRange(db, range)),
    );
    for (const result of results) computed.push(...result);
  }

  await persist(db, computed);

  for (const rollup of computed) stored.set(rollup.date, rollup);
  return days.map((day) => stored.get(day)!);
}

/** One scan over a run of consecutive days, split back out per day.
 *
 * A range that hits a scan cap is redone a day at a time: the cap is
 * per-collection-per-query, so seven days sharing one costs the oldest of them
 * its events, and that undercount would then be written down as if it were the
 * answer. Per day the cap is the same 20,000 a single-day window gets, and a
 * day that still hits it is stored with its `truncated` kinds recorded.
 */
async function buildRange(
  db: Firestore,
  range: string[],
): Promise<DailyRollup[]> {
  const first = range[0]!;
  const last = range[range.length - 1]!;

  const { events, truncated } = await collectActivityEvents(db, {
    sinceIso: dayStartIso(first),
    untilIso: dayEndIso(last),
  });

  if (truncated.length > 0 && range.length > 1) {
    console.warn(
      `activityDaily: ${first}..${last} hit the scan cap for ` +
        `${[...new Set(truncated)].join(", ")}; recounting day by day`,
    );
    const perDay = await Promise.all(range.map((day) => buildRange(db, [day])));
    return perDay.flat();
  }

  const byDay = new Map<string, ActivityEvent[]>(range.map((day) => [day, []]));
  for (const event of events) {
    const day = utcDay(event.at);
    if (day) byDay.get(day)?.push(event);
  }

  return range.map((day) => rollupForDay(day, byDay.get(day)!, truncated));
}

async function readRollups(
  db: Firestore,
  days: string[],
): Promise<Map<string, DailyRollup>> {
  const found = new Map<string, DailyRollup>();

  // `getAll` takes the whole list, but a 365-day window is 365 refs in one
  // argument list; 300 at a time keeps that bounded without costing a round
  // trip on any window the page actually offers.
  for (let i = 0; i < days.length; i += 300) {
    const chunk = days.slice(i, i + 300);
    const snapshots = await db.getAll(
      ...chunk.map((day) => db.collection(COLLECTION).doc(day)),
    );
    for (const snapshot of snapshots) {
      const rollup = decodeRollup(snapshot.id, snapshot.data());
      if (rollup) found.set(rollup.date, rollup);
    }
  }

  return found;
}

/** The stored document, or null if it is absent or was counted under an older
 * rule. Anything unreadable is treated as absent and recomputed - a rollup is
 * derived data, so there is nothing to salvage from a malformed one. */
function decodeRollup(
  id: string,
  data: Record<string, unknown> | undefined,
): DailyRollup | null {
  if (!data || data.version !== ROLLUP_VERSION) return null;

  // Cast to something nullable rather than to the shape this hopes for: the
  // document came off the wire, and a rollup is derived data, so anything
  // unreadable in it is recomputed rather than trusted.
  const stored = data.contributors as
    Record<string, Record<string, unknown> | undefined> | undefined;

  const contributors: DailyRollup["contributors"] = {};
  for (const [uid, entry] of Object.entries(stored ?? {})) {
    const lastActiveAt = entry?.lastActiveAt;
    if (typeof lastActiveAt !== "string") continue;
    contributors[uid] = { counts: decodeCounts(entry), lastActiveAt };
  }

  return {
    date: id,
    totals: decodeCounts(data.totals as Record<string, unknown> | undefined),
    contributors,
    truncated: Array.isArray(data.truncated)
      ? (data.truncated.filter((kind) =>
          activityKinds.includes(kind as ActivityKind),
        ) as ActivityKind[])
      : [],
  };
}

/** Zero counts are left out of the stored document, so every read fills them
 * back in - a chart must never have to tell "zero" from "absent". */
function decodeCounts(
  source: Record<string, unknown> | undefined,
): ActivityCounts {
  const counts = emptyActivityCounts();
  for (const kind of activityKinds) {
    const value = source?.[kind];
    if (typeof value === "number" && Number.isFinite(value))
      counts[kind] = value;
  }
  return counts;
}

function encodeCounts(counts: ActivityCounts): Record<string, number> {
  return Object.fromEntries(
    activityKinds
      .filter((kind) => counts[kind] > 0)
      .map((kind) => [kind, counts[kind]]),
  );
}

async function persist(db: Firestore, rollups: DailyRollup[]): Promise<void> {
  if (rollups.length === 0) return;

  // One try per batch, not one around the loop. A commit is atomic, so a batch
  // that a single unwritable day poisons takes the other 399 down with it -
  // and a day that can never be written would, from outside the loop, mean no
  // day in the window is ever stored again. Per batch, the damage is bounded to
  // the days that share the bad one's commit.
  for (let i = 0; i < rollups.length; i += WRITE_BATCH) {
    const slice = rollups.slice(i, i + WRITE_BATCH);
    try {
      const batch = db.batch();
      for (const rollup of slice) {
        batch.set(db.collection(COLLECTION).doc(rollup.date), {
          version: ROLLUP_VERSION,
          date: rollup.date,
          computedAt: new Date().toISOString(),
          totals: encodeCounts(rollup.totals),
          truncated: rollup.truncated,
          contributors: Object.fromEntries(
            Object.entries(rollup.contributors).map(([uid, entry]) => [
              uid,
              {
                ...encodeCounts(entry.counts),
                lastActiveAt: entry.lastActiveAt,
              },
            ]),
          ),
        });
      }
      await batch.commit();
    } catch (error) {
      // Deliberately swallowed - see the note on `ensureDailyRollups`. Named,
      // so a day that never sticks can be found rather than guessed at.
      console.error(
        `activityDaily: could not store ${slice[0]?.date}..${slice[slice.length - 1]?.date}`,
        error,
      );
    }
  }
}

/** Split a sorted list of days into runs of consecutive dates, each run cut
 * into pieces of at most `size`. A gap in the middle - the usual case, where
 * only the newest days are missing - must not be scanned across, or the scan
 * would re-read days that are already counted. */
function chunkContiguous(days: string[], size: number): string[][] {
  const runs: string[][] = [];
  for (const day of days) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];
    if (
      current &&
      current.length < size &&
      previous &&
      dayEndIso(previous).slice(0, 10) === day
    ) {
      current.push(day);
    } else {
      runs.push([day]);
    }
  }
  return runs;
}

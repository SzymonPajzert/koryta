import {
  emptyActivityCounts,
  totalActivity,
  type ActivityCounts,
  type ActivityKind,
} from "~~/shared/activity";
import { DECLARATION_ACTOR } from "~~/shared/declarations";
import { isAutomatedUid, isPipelineUid } from "~~/shared/stats";

/** One thing a human did, normalized out of whichever collection recorded it.
 *
 * `at` is an ISO instant and days are cut from its UTC prefix, so a reader in
 * Warsaw sees late-evening work land on the next day. That is the convention
 * the collections themselves are written in — every timestamp is stored as UTC
 * — and re-cutting per viewer would make the server's totals and the browser's
 * chart disagree.
 */
export type ActivityEvent = {
  uid: string;
  kind: ActivityKind;
  at: string;
  /** Units this event contributes. A note carries one per source it holds. */
  count?: number;
};

export type DailyActivity = {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  counts: ActivityCounts;
  total: number;
  /** People the declarations' automation published on its own that day. Not
   * in `counts` or `total`, which are what people did. */
  automatic: number;
};

export type ContributorAggregate = {
  uid: string;
  counts: ActivityCounts;
  total: number;
  lastActiveAt: string;
};

export type ActivityAggregate = {
  totals: ActivityCounts;
  total: number;
  daily: DailyActivity[];
  /** Sorted by total desc, then uid so equal totals keep a stable order. */
  contributors: ContributorAggregate[];
  /** People the declarations' automation published on its own in the
   * window (`isAutomaticPublication`): counted apart, and never a
   * contributor. */
  automatic: number;
};

/** Writes the site makes on a person's behalf - the scoring pipeline's, and a
 * migration script's. They dwarf everything a human does and would turn the
 * page into a chart of one robot's day: `migration:merge-duplicate-people` filed
 * 1,081 revisions on 2026-08-31 in the minutes one run took, more than every
 * human revision in the export bar the owner's.
 *
 * Defined next to the vote aggregate that has to draw the same line, and
 * re-exported here because the activity page drew it first. */
export { isAutomatedUid, isPipelineUid };

/** A page the declarations' automation put up on its own, which is not
 * somebody's work but is what the readers' work led to, so it is shown as
 * the automation's: beside the people's counts, never inside them. A page an
 * administrator pressed „Opublikuj z kolejki” for is theirs (`pressed_by`),
 * and everything else a robot files stays out. */
export function isAutomaticPublication(event: ActivityEvent): boolean {
  return event.uid === DECLARATION_ACTOR && event.kind === "publication";
}

/** The UTC day an instant falls on, or null if it cannot be read as one. */
export function utcDay(at: string | null | undefined): string | null {
  if (!at) return null;
  const day = at.split("T")[0];
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Every UTC day from `since` to `until` inclusive, so a quiet day is a zero
 * column rather than a gap the eye reads as "no data". */
export function daysBetween(since: string, until: string): string[] {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const days: string[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let t = start; t <= end; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Roll a flat list of events up into the three views the stats page needs: a
 * grand total per kind, a gap-free daily series, and a per-contributor
 * leaderboard.
 *
 * Events outside `[since, until]` are dropped rather than clamped — the
 * collection queries are windowed on their own timestamp fields, and a note
 * whose sources are attributed to its last edit can still land just outside.
 */
export function aggregateActivity(
  events: ActivityEvent[],
  window: { since: string; until: string },
): ActivityAggregate {
  const days = daysBetween(window.since, window.until);
  const inWindow = new Set(days);

  const byDay = new Map<string, ActivityCounts>(
    days.map((day) => [day, emptyActivityCounts()]),
  );
  const byUid = new Map<string, ContributorAggregate>();
  const totals = emptyActivityCounts();
  const automaticByDay = new Map<string, number>();
  let automatic = 0;

  for (const event of events) {
    const shown = isAutomaticPublication(event);
    if (!shown && isAutomatedUid(event.uid)) continue;
    const day = utcDay(event.at);
    if (!day || !inWindow.has(day)) continue;

    const count = event.count ?? 1;
    if (count <= 0) continue;

    if (shown) {
      automatic += count;
      automaticByDay.set(day, (automaticByDay.get(day) ?? 0) + count);
      continue;
    }

    totals[event.kind] += count;
    byDay.get(day)![event.kind] += count;

    let contributor = byUid.get(event.uid);
    if (!contributor) {
      contributor = {
        uid: event.uid,
        counts: emptyActivityCounts(),
        total: 0,
        lastActiveAt: event.at,
      };
      byUid.set(event.uid, contributor);
    }
    contributor.counts[event.kind] += count;
    contributor.total += count;
    if (event.at > contributor.lastActiveAt)
      contributor.lastActiveAt = event.at;
  }

  return {
    totals,
    total: totalActivity(totals),
    daily: days.map((date) => {
      const counts = byDay.get(date)!;
      return {
        date,
        counts,
        total: totalActivity(counts),
        automatic: automaticByDay.get(date) ?? 0,
      };
    }),
    contributors: [...byUid.values()].sort(
      (a, b) => b.total - a.total || (a.uid < b.uid ? -1 : 1),
    ),
    automatic,
  };
}

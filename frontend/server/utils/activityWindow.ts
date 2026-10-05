import { getFirestore } from "firebase-admin/firestore";
import { collectActivityEvents } from "~~/server/utils/activityEvents";
import {
  identify,
  readPublicProfiles,
  type ContributorIdentity,
} from "~~/server/utils/contributors";
import {
  dayStartIso,
  ensureDailyRollups,
  mergeRollups,
  mergeTruncated,
  rollupForDay,
  splitSettledDays,
  type DailyRollup,
} from "~~/server/utils/activityRollup";
import {
  daysBetween,
  type ActivityAggregate,
} from "~~/server/utils/activityStats";
import type { ActivityKind } from "~~/shared/activity";

/** How many contributors the leaderboard resolves names for. Well past the
 * number of people who have ever been active in a week, and it keeps the
 * response — and the auth lookups behind it — bounded either way. */
export const LEADERBOARD_SIZE = 25;

export type WindowedActivity = {
  window: { since: string; until: string; days: number };
  aggregate: ActivityAggregate;
  truncated: ActivityKind[];
  /** Display data for the ranked slice, from the auth service. Server side
   * only — `present` decides which fields of it any given caller may see. */
  identities: Record<string, ContributorIdentity>;
  /** Which of the ranked contributors agreed to be named in public. */
  public: Record<string, boolean>;
};

/** The whole read-and-roll-up, memoized per window length.
 *
 * Shared by the public ranking (`/api/stats/activity`) and the administrators'
 * list of accounts (`/api/admin/users`), which reads the 90-day entry for every
 * contributor's counts - one memo, so the two never count the same days twice.
 *
 * Five minutes of staleness on a chart of days is not worth noticing, and the
 * memo is what keeps the auth and `users` lookups off the per-request path as
 * well. What it holds is shared between callers, so it holds everything anyone
 * may see and nothing is stripped out on the way in — `present` does the
 * stripping, per caller, on the way out.
 */
export const cachedActivityWindow = defineCachedFunction(
  async (days: number): Promise<WindowedActivity> => {
    const until = new Date();
    const since = new Date(until);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);

    const window = {
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
      days,
    };

    const db = getFirestore("koryta-pl");

    // A settled day is counted once and kept; the tail of the window is read
    // live, because a vote stamped by a slow browser clock can still land in it.
    // `daysBetween` ends on `until`, which is today, so `live` is never empty.
    const spanned = daysBetween(window.since, window.until);
    const { settled, live } = splitSettledDays(spanned, until);
    const [past, current] = await Promise.all([
      ensureDailyRollups(db, settled),
      collectActivityEvents(db, {
        sinceIso: dayStartIso(live[0] ?? window.until),
      }),
    ]);

    // One scan covers every live day; `rollupForDay` keeps only the events that
    // fall on the day it is given, so handing it the same list per day is what
    // splits them.
    const rollups: DailyRollup[] = [
      ...past,
      ...live.map((day) =>
        rollupForDay(day, current.events, current.truncated),
      ),
    ];

    const aggregate = mergeRollups(spanned, rollups);
    const ranked = aggregate.contributors.slice(0, LEADERBOARD_SIZE);
    const [identities, publicProfiles] = await Promise.all([
      identify(ranked.map((c) => c.uid)),
      readPublicProfiles(
        db,
        ranked.map((c) => c.uid),
      ),
    ]);

    return {
      window,
      aggregate,
      truncated: mergeTruncated(rollups),
      identities,
      public: publicProfiles,
    };
  },
  {
    name: "stats-activity",
    maxAge: 300,
    swr: true,
    getKey: (days: number) => String(days),
  },
);

import type { Firestore } from "firebase-admin/firestore";
import { collectActivityEvents } from "~~/server/utils/activityEvents";
import {
  dayStartIso,
  ensureDailyRollups,
  rollupForDay,
  splitSettledDays,
  type DailyRollup,
} from "~~/server/utils/activityRollup";
import { daysBetween } from "~~/server/utils/activityStats";

export type ActivityWindow = { since: string; until: string; days: number };

/** The last `days` UTC days of activity, one rollup per day, ending today.
 *
 * A settled day is counted once and kept; the tail of the window is read live,
 * because a vote stamped by a slow browser clock can still land in it. The
 * rollups come back unmerged, so a caller can cut a shorter window out of a
 * longer one without reading anything twice - `mergeRollups` with the days it
 * wants does the rest.
 */
export async function loadActivityRollups(
  db: Firestore,
  days: number,
  until: Date = new Date(),
): Promise<{
  window: ActivityWindow;
  spanned: string[];
  rollups: DailyRollup[];
}> {
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const window = {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    days,
  };

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
    ...live.map((day) => rollupForDay(day, current.events, current.truncated)),
  ];

  return { window, spanned, rollups };
}

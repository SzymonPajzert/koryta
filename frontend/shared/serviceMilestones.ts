import { isoDay } from "./dates";

/** One spell of service, as the milestone arithmetic needs it: two days, the
 * second of which may be missing because the post is still held. */
export type ServiceSpell = {
  start: string;
  end?: string | null;
};

/** A spell reduced to day numbers, with `null` for one still running. */
export type DaySpan = { start: number; end: number | null };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since the epoch, or null for anything that is not an ISO day.
 *
 * A day number rather than a `Date`, because everything below is arithmetic on
 * whole days and a `Date` invites an hour of daylight saving into it.
 */
export function dayNumber(iso: string | null | undefined): number | null {
  const day = isoDay(iso?.slice(0, 10));
  if (!day) return null;
  return Math.round(Date.UTC(day.y, day.m - 1, day.d) / DAY_MS);
}

/** The ISO day a day number stands for. */
export function dayIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** `day` moved on by `years` calendar years, clamped rather than rolled.
 *
 * 29 February plus one year is 28 February, not 1 March: `Date.UTC` rolls a
 * day the calendar does not have forward, which would put a milestone on a
 * date nobody served through.
 */
export function addYears(day: number, years: number): number {
  const at = new Date(day * DAY_MS);
  const y = at.getUTCFullYear() + years;
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(y, m, Math.min(d, lastOfMonth)) / DAY_MS);
}

/** The spells, in order, with overlaps folded together.
 *
 * Two posts held at once are one stretch of service, not two - the same rule
 * `calculateExperience` applies, and it has to be the same one: this decides
 * when somebody reaches ten years and that decides what the page says their
 * total is. A spell still running swallows whatever follows it.
 *
 * Abutting spells are left separate, again matching `calculateExperience`: a
 * spell is measured end minus start, so 1 January to 30 June is 180 days and
 * not 181, and merging it with a spell starting on 1 July would silently add
 * the day back.
 */
export function mergeSpells(spells: ServiceSpell[]): DaySpan[] {
  const spans: DaySpan[] = [];
  for (const spell of spells) {
    const start = dayNumber(spell.start);
    if (start === null) continue;
    const end = spell.end ? dayNumber(spell.end) : null;
    // A spell that ends before it begins is a row somebody mistyped; counting
    // it would take days off the total.
    if (end !== null && end < start) continue;
    spans.push({ start, end });
  }

  spans.sort(
    (a, b) => a.start - b.start || (a.end ?? Infinity) - (b.end ?? Infinity),
  );

  const merged: DaySpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= (last.end ?? Infinity)) {
      last.end =
        last.end === null || span.end === null
          ? null
          : Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

/** The day somebody's service adds up to `years` whole years, or null if it
 * never does.
 *
 * Not the anniversary of anything, once there is a gap in the career. Ten
 * years of service beginning in 2010 with three years out of it in the middle
 * is reached in 2023, and the point of this page is that the date is worth
 * working out rather than guessed at from a start date.
 *
 * How long a year is: the length of `years` calendar years measured from the
 * **first day served**. That keeps the common case exact - an unbroken career
 * reaches ten years on the tenth anniversary of the day it started, to the day
 * - and gives a gapped one the same reckoning shifted by however long the gaps
 * were. Averaging 365.25 days instead would put an unbroken career's tenth
 * year two days off its own anniversary, which no reader would accept.
 *
 * `projectTo` bounds a spell that is still running. Without it a post nobody
 * has closed accrues forever and the walk below would happily promise somebody
 * their sixtieth year in 2086.
 */
export function milestoneDay(
  merged: DaySpan[],
  years: number,
  projectTo: number,
): number | null {
  const first = merged[0];
  if (!first || years < 1) return null;

  const needed = addYears(first.start, years) - first.start;
  let served = 0;
  for (const span of merged) {
    const end = span.end ?? projectTo;
    // A spell that has not started by the projection horizon contributes
    // nothing, and neither does one already closed before it began.
    const length = Math.max(0, end - span.start);
    if (served + length >= needed) return span.start + (needed - served);
    served += length;
  }
  return null;
}

/** Every whole year of service reached between `from` and `to`, in order.
 *
 * Milestone days only ever increase with the year they mark, so the walk stops
 * at the first one past the end of the window rather than testing all sixty.
 */
export function milestonesInWindow(
  merged: DaySpan[],
  from: number,
  to: number,
): { years: number; day: number }[] {
  const found: { years: number; day: number }[] = [];
  for (let years = 1; ; years++) {
    const day = milestoneDay(merged, years, to);
    // Null means the career is over and never added up to this much, so no
    // later milestone can be reached either.
    if (day === null) break;
    if (day > to) break;
    if (day >= from) found.push({ years, day });
  }
  return found;
}

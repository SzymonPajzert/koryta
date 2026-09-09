/**
 * Register days, written the way the site writes them.
 *
 * The formatters were declared inline in `succession/CompanyChanges.vue` and
 * again in `succession/PersonChanges.vue`, and the two copies had already
 * drifted - only the first grew a long form. explore/Table.vue would have been
 * the third, so they live here instead.
 */

/** The three numbers of an ISO day. */
export type IsoDay = { y: number; m: number; d: number };

// `timeZone: "UTC"` against a date built with `Date.UTC`: a register day is a
// day, not an instant, and left to the local zone a browser west of Greenwich
// renders every one of them as the day before.
const LONG_DATE = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The three numbers in an ISO day, or null for anything else.
 *
 * Deliberately strict, same as `spellDate` in `shared/succession.ts`: `new
 * Date("2016")` answers 1 January, which would print a date the register never
 * recorded. A day the calendar does not have - "2024-02-31" - is rejected for
 * the same reason: `Date.UTC` rolls it forward into March rather than refusing
 * it, so the shape of the string is not enough on its own.
 */
export function isoDay(iso: string | null | undefined): IsoDay | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return null;
  const day = {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
  };
  const rolled = new Date(Date.UTC(day.y, day.m - 1, day.d));
  if (
    rolled.getUTCFullYear() !== day.y ||
    rolled.getUTCMonth() + 1 !== day.m ||
    rolled.getUTCDate() !== day.d
  ) {
    return null;
  }
  return day;
}

function utc(day: IsoDay): Date {
  return new Date(Date.UTC(day.y, day.m - 1, day.d));
}

/** „12 kwietnia 2024”. */
export function longDate(
  iso: string | null | undefined,
  fallback = "brak daty",
): string {
  const day = isoDay(iso);
  return day ? LONG_DATE.format(utc(day)) : fallback;
}

/** „12.04.2024”, for the places that print two dates and a dash. */
export function shortDate(
  iso: string | null | undefined,
  fallback = "brak daty",
): string {
  const day = isoDay(iso);
  return day ? SHORT_DATE.format(utc(day)) : fallback;
}

/**
 * „kwietnia 2024”: the month and the year, for a row too narrow for the day.
 *
 * Read off the parts of the long form rather than formatted from a
 * `{ month: "long", year: "numeric" }` skeleton of its own, which answers
 * „marzec 2019” - the nominative. Every caller writes „od …” in front of it,
 * and Polish wants the genitive there: „od marca 2019”.
 */
export function monthYear(
  iso: string | null | undefined,
  fallback = "",
): string {
  const day = isoDay(iso);
  if (!day) return fallback;
  const parts = LONG_DATE.formatToParts(utc(day));
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  return month && year ? `${month} ${year}` : fallback;
}

/** The Warsaw calendar date, `YYYY-MM-DD`.
 *
 * Lived in `server/utils/crawledBucket.ts`, which is where the crawler needs
 * it to partition a bucket; `/api/edges/anniversaries` needs the same answer
 * to decide which day's anniversaries it is listing, and importing a module
 * that pulls in `firebase-admin/storage` and half of `node:fs` to ask what day
 * it is was the wrong dependency.
 *
 * The zone is the whole point. App Hosting runs in UTC, so between midnight
 * and 02:00 Warsaw time a UTC date is still yesterday - which for a feed keyed
 * on "today" means the page shows the wrong day's list for the first two hours
 * of it.
 */
export function warsawDate(now: Date = new Date()): string {
  // en-CA gives YYYY-MM-DD, which is the format every caller compares against.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

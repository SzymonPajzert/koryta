/** "24.09.2026 14:05" - the day and the minute, in Warsaw whatever the
 * browser's zone, like every other clock on the site.
 *
 * One format for every moment the revision pages print. The queue's rows, the
 * edge and entry rows and the comparison table's column heads each called
 * `toLocaleString("pl-PL")` of their own, which writes "1.09.2026, 11:00:00":
 * seconds nobody decides by, the browser's zone rather than the one the
 * revision was written in, and a date that read differently from the history
 * list's "01.09.2026 11:00" a line above it. The history list's formatter is
 * the one that stayed, moved here. */
const MOMENT = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Warsaw",
});

/** An ISO string or epoch milliseconds as "24.09.2026 14:05"; "—" for a
 * moment that is missing or unreadable. */
export function formatMoment(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : MOMENT.format(date).replace(", ", " ");
}

/** The Warsaw calendar day, as `2026-10-15` - `en-CA` writes year-month-day. */
const WARSAW_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the Warsaw calendar day `date` falls on, so two of them are
 * a whole number of days apart whatever the clocks did in between. */
const warsawDay = (date: Date) =>
  Date.parse(`${WARSAW_DAY.format(date)}T00:00:00Z`);

/** "dzisiaj" / "wczoraj" / "3 dni temu" - how many Warsaw calendar days ago a
 * moment was; "—" for one that is missing or unreadable.
 *
 * Printed under `formatMoment`, so it counts the same days that one prints.
 * `formatDaysAgo` counts 24-hour blocks instead, which put a revision filed at
 * 22:41 yesterday under "dzisiaj" two hours later - beneath a date that said
 * otherwise. */
export function formatDayDistance(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const days = Math.round(
    (warsawDay(new Date(Date.now())) - warsawDay(date)) / DAY_MS,
  );
  if (days <= 0) return "dzisiaj";
  if (days === 1) return "wczoraj";
  return new Intl.RelativeTimeFormat("pl-PL", { numeric: "always" }).format(
    -days,
    "day",
  );
}

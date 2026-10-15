import { isoDay, shortDate, warsawDate } from "~~/shared/dates";

/** A relation's two ends as they are printed: the start, and the end or
 * „obecnie” for a post still held. `end` is undefined where there is no range
 * to print - a single day, or no dates at all.
 *
 * Both ends are optional - an edge entered through the editor may carry no date
 * at all - so neither may be interpolated unguarded: doing that is how 117
 * published people came to read „undefined - obecnie". „obecnie" is only right
 * for the end, because a missing start is unknown rather than today.
 *
 * Separate rather than one string so a caller can set „obecnie” apart: a post
 * held today reads stronger than one that ended in 2008.
 */
export function relationPeriodParts(
  start: string | undefined,
  end: string | undefined,
): { start: string; end?: string; current: boolean } {
  if (!start && !end) return { start: "", current: false };
  if (start && end && start === end) return { start, current: false };
  return { start: start ?? "?", end: end || "obecnie", current: !end };
}

/** How long a relation lasted, in one line: „2014-11-06 - 2017-08-25".
 *
 * A range takes an en dash, not a hyphen: „2014-11-06 - 2017-08-25” read as
 * one long number broken by a minus.
 *
 * Lives here rather than inside `chip/RelativeDuration.vue` because the phone
 * layout of `card/EmploymentHistory.vue` prints the period without the bar -
 * the 200px track measures wider than the row it would sit in - and two copies
 * of this rule would drift apart on the two ends nobody remembers to guard.
 */
export function relationPeriodLabel(
  start: string | undefined,
  end: string | undefined,
): string {
  const parts = relationPeriodParts(start, end);
  return parts.end === undefined
    ? parts.start
    : `${parts.start} - ${parts.end}`;
}

/** A register date in the site's one format: „19.08.2026” for a whole day,
 * „08.2026” for a month (the relation form takes RRRR-MM), a year as it is.
 * Anything else is printed as it was written rather than guessed at. */
function registerDay(iso: string): string {
  if (isoDay(iso)) return shortDate(iso);
  const month = /^(\d{4})-(\d{2})$/.exec(iso);
  return month ? `${month[2]}.${month[1]}` : iso;
}

/** Whether a post is held on `today`: it has no end, or its end - a term of
 * office entered ahead, „kadencja do 2027” - has not come yet. A partial end
 * is compared at its own precision, so „2026” is still running all of 2026.
 * The rule the hospital statistics count by (`end_date < today` is over). */
function heldOn(end: string | undefined, today: string): boolean {
  return !end || end > today.slice(0, end.length) || today.startsWith(end);
}

/** The period as a person's history prints it in its own column, in the one
 * format the register's dates take on the site (`text`), and in years alone
 * (`years`) for a phone's role line: „od 19.08.2026” for a post
 * still held, „15.05.2023 – 04.12.2024” for one that ended, „25.09.2005” for
 * a single day and „do 26.07.2010” where only the end is known. Never
 * „– obecnie”: „od” already says the post is held, and `current` lets the
 * caller set it in bold - including a term whose end is still ahead, which
 * keeps its range. Undefined for a relation with no dates. */
export function ledgerPeriod(
  start: string | undefined,
  end: string | undefined,
  {
    today = warsawDate(),
    yearOnly = false,
  }: {
    today?: string;
    /** Print the year alone in both forms. For a candidacy, whose day is
     * not the register's: the server substitutes one election day per year
     * whatever the office (`electionConcreteDate`, server/utils/fetch.ts), so
     * a 2010 council candidacy would read 20.06.2010 - the presidential
     * vote. The year is the part that is true. */
    yearOnly?: boolean;
  } = {},
): { text: string; years: string; current: boolean } | undefined {
  const period = ledgerPeriodOf(start, end, today);
  return period && yearOnly ? { ...period, text: period.years } : period;
}

function ledgerPeriodOf(
  start: string | undefined,
  end: string | undefined,
  today: string,
): { text: string; years: string; current: boolean } | undefined {
  if (!start && !end) return undefined;
  if (start && end && start === end) {
    // A single day still ahead - an election announced for next spring - is
    // as current as a post held today; one that has passed is over.
    return {
      text: registerDay(start),
      years: yearOf(start),
      current: heldOn(end, today),
    };
  }
  const current = heldOn(end, today);
  if (!end) {
    return {
      text: `od ${registerDay(start!)}`,
      years: `od ${yearOf(start!)}`,
      current,
    };
  }
  if (!start) {
    return {
      text: `do ${registerDay(end)}`,
      years: `do ${yearOf(end)}`,
      current,
    };
  }
  const [from, to] = [yearOf(start), yearOf(end)];
  return {
    text: `${registerDay(start)} – ${registerDay(end)}`,
    // As the table writes a span of years: „2023–2024”, one year once.
    years: from === to ? from : `${from}–${to}`,
    current,
  };
}

/** The year a register date begins with, or the date as written. */
function yearOf(iso: string): string {
  return /^\d{4}/.exec(iso)?.[0] ?? iso;
}

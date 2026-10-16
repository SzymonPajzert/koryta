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

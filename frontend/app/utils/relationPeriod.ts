/** How long a relation lasted, in one line: „2014-11-06 - 2017-08-25".
 *
 * Both ends are optional - an edge entered through the editor may carry no date
 * at all - so neither may be interpolated unguarded: doing that is how 117
 * published people came to read „undefined - obecnie". „obecnie" is only right
 * for the end, because a missing start is unknown rather than today.
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
  if (!start && !end) return "";
  if (start && end && start === end) return start;
  return `${start ?? "?"} - ${end || "obecnie"}`;
}

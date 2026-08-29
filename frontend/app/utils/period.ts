/** How a spell of time reads: "2014-11-06 - 2017-08-25", "2014-11-06 -
 * obecnie", or the single date where both ends fall on it.
 *
 * Lifted out of `chip/RelativeDuration.vue`, where it was a computed, because a
 * relation row now prints its period twice over: under the duration bar on a
 * desktop, and as plain text beside the role below md, where the bar is 200px
 * of fixed width inside a column half that wide and gets clipped at both ends.
 * Two copies of the wording would drift apart, and one of them has form - the
 * template that used to interpolate the dates straight is how 117 published
 * people came to read "undefined - obecnie".
 */
export function periodLabel(
  start: string | undefined,
  end: string | undefined,
): string {
  // Both ends are optional - an edge entered through the editor may carry no
  // date at all - so neither may be interpolated unguarded. "obecnie" is only
  // right for the end: a missing start is unknown, not today.
  if (!start && !end) {
    return "";
  }
  if (start && end && start === end) {
    return start;
  }
  return `${start ?? "?"} - ${end || "obecnie"}`;
}

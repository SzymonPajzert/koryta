/** Polish typesetting for text that comes from data: no one-letter word at
 * the end of a line.
 *
 * A Polish line may not end in „a”, „i”, „o”, „u”, „w” or „z” - the word
 * belongs to the one after it - and a browser breaks wherever there is a space.
 * The site's own copy writes `&nbsp;` where it needs one; a bio, a section
 * title or a lead read from the database cannot, so this puts a non-breaking
 * space after each such word instead. Only after a space, an opening bracket
 * or quote, or at the start, so „w” inside a word is left alone.
 */
export function nbsp(text: string): string {
  return text.replace(/(?<=^|[\s(„"])([aiouwzAIOUWZ]) (?=\S)/g, "$1 ");
}

import { shortPersonName } from "~~/shared/names";

/** How wide a label line may get before it is broken, in characters.
 *
 * Not a measurement - the graph draws at whatever zoom the reader has - but a
 * width that keeps an institution's name from reaching across the canvas and
 * over the nodes on either side of it. Roughly two words of Polish. */
const MAX_CHARS = 18;

/** How many lines one label may take.
 *
 * The names that need breaking at all are the long institutional ones, and
 * those run to a hundred characters - "Wojewódzki Fundusz Ochrony Środowiska i
 * Gospodarki Wodnej w ...". Four lines is enough to reach the part that tells
 * two of them apart, which is usually the town at the end, and past that a
 * label is a paragraph sitting on top of the graph. */
const MAX_LINES = 4;

/** Break a node's name into lines the canvas can hold.
 *
 * v-network-graph splits label text on newlines and draws a `tspan` per line,
 * so wrapping is a matter of putting them in. Words are kept whole where they
 * fit; one longer than a whole line - a run-together name, an address - is cut
 * rather than allowed to set the width on its own.
 *
 * A label that runs past `maxLines` ends in an ellipsis: the node is still
 * there to click through to, and the alternative is a caption that covers what
 * it is a caption for.
 */
export function wrapLabel(
  text: string,
  { maxChars = MAX_CHARS, maxLines = MAX_LINES } = {},
): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  for (const word of words) {
    let rest = word;
    // A word wider than the line gets broken where the line ends, since no
    // amount of wrapping will make it fit.
    while (rest.length > maxChars) {
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }

    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + rest.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${rest}`;
    } else if (rest) {
      lines.push(rest);
    }
  }

  if (lines.length <= maxLines) return lines.join("\n");

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s+$/, "")}…`;
  return kept.join("\n");
}

/** The name of a person, as short as still names them.
 *
 * A page carries every given name the register knows, and a circle on the
 * graph is captioned by the first name and the surname alone
 * (`shortPersonName`): "Antoni Ignacy Sikoń" is "Antoni Sikoń" there, as the
 * press would write him, and the page one click away says the rest.
 *
 * The outer ring of a two hop graph is drawn at fourteen characters over two
 * lines, and even a first name and a surname can be too long for it: wrapped by
 * width alone, "Bogusław-Aleksander Nowak" is broken inside its first word, and
 * a longer one ends in an ellipsis that ate the surname - the one part that
 * tells two Bogusławs apart. So before giving up the end of a name, give up its
 * front: the given names shrink to initials. "B. Nowak" is a person;
 * "Bogusław-Aleks…" is not. A middle word `shortPersonName` could not tell
 * from a surname is kept, and shrinks to its initial the same way.
 *
 * Only for the circles. An institution's name is long at the front as well as
 * at the back and its initials would say nothing, so it keeps `wrapLabel`.
 */
export function personLabel(
  name: string,
  { maxChars = MAX_CHARS, maxLines = MAX_LINES } = {},
): string {
  const short = shortPersonName(name);
  const words = short.split(/\s+/).filter(Boolean);
  const shorten = (from: number) => [
    ...words.slice(0, from),
    ...words.slice(from, -1).map((word) => `${[...word][0]}.`),
    words[words.length - 1]!,
  ];

  // Fullest first, and the last candidate is what is drawn if even that has to
  // be cut - by then it is the surname being cut, which is the best a
  // fourteen-character line can do.
  const candidates =
    words.length > 2
      ? [short, shorten(1).join(" "), shorten(0).join(" ")]
      : words.length === 2
        ? [short, shorten(0).join(" ")]
        : [short];

  let wrapped = wrapLabel(candidates[0]!, { maxChars, maxLines });
  for (const candidate of candidates) {
    wrapped = wrapLabel(candidate, { maxChars, maxLines });
    // Nothing lost off the end, and nothing broken in the middle either:
    // "Bogusław-Aleks / ander Nowak" fits the box and still costs a reader the
    // second it takes to reassemble a name, where "B. Nowak" costs nothing.
    const whole = candidate
      .split(/\s+/)
      .every((word) => word.length <= maxChars);
    if (whole && !wrapped.endsWith("…")) return wrapped;
  }
  return wrapped;
}

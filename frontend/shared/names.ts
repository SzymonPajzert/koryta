/** A person's name reduced to what two spellings of the same person share.
 *
 * The extraction pipeline writes the name as the article spelled it, and the
 * graph stores whatever the register did. Joining a fact to the person node the
 * mention matcher confirmed means comparing those two strings, and comparing
 * them verbatim fails on the things that carry no meaning: case, the diacritics
 * a newsroom CMS sometimes drops, and whether a double surname was hyphenated.
 *
 * Deliberately looser than `createSlug`, which has to stay a url segment: this
 * only has to be stable enough that "Rafał Trzaskowski" and "Rafal
 * Trzaskowski" land on the same key. It does not try to be clever about
 * initials, middle names or declension - a fact naming somebody differently
 * from the graph is left unmatched rather than matched to a guess.
 */
export function normalizePersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // ą ć ę ń ó ś ź ż lose their marks
    .replace(/[łŁ]/g, "l") // ł is its own codepoint, so NFD leaves it alone
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // hyphens, dots and quotes are word breaks
    .trim();
}

/** Whether `full` is `short` with given names written in after the first.
 *
 * rejestr.io spells one register entry the way each company's filing has it,
 * with the middle name and without - "Antoni Sikoń" at one company, "Antoni
 * Ignacy Sikoń" at the next - and a page made from the short form used to stay
 * short. The longer one is the same name, more of it: it begins and ends with
 * the words `short` does and keeps every one of them, in order and exactly as
 * written, adding words only in between. A spelling that changes anything -
 * another surname, a typo, the case of a word - is a different spelling, and
 * the page's may be a reviewer's.
 *
 * A word the register typed twice is not a middle name either: "Mirosław Dywan
 * Dywan" is a filing's slip, not a man whose middle name is his surname.
 *
 * `adds_middle_names` in `data/pipelines/src/util/polish.py` is the same rule,
 * and the two have to agree: the ingest renames a page by this one, and the
 * pipeline's `--only-changed` predicts the rename by that one.
 */
export function addsMiddleNames(full: string, short: string): boolean {
  const longer = full.split(/\s+/).filter(Boolean);
  const shorter = short.split(/\s+/).filter(Boolean);
  if (shorter.length < 2 || longer.length <= shorter.length) return false;
  if (longer[0] !== shorter[0] || longer.at(-1) !== shorter.at(-1)) {
    return false;
  }
  const added: string[] = [];
  let kept = 0;
  for (const word of longer) {
    if (kept < shorter.length && word === shorter[kept]) kept += 1;
    else added.push(word);
  }
  if (kept < shorter.length) return false;
  return !added.some((word) => word === shorter[0] || word === shorter.at(-1));
}

/** The keys a fact's spelling of a person may meet their page's name under.
 *
 * A page carries every given name the register knows, and an article almost
 * never does: it writes "Antoni Sikoń" about Antoni Ignacy Sikoń, and matched
 * on the whole name alone the fact was left off his page. So besides the whole
 * name, the name without its second word - "Urszula Lucyna Wach Górny" is
 * Urszula Wach Górny in print, a double surname written with a space - and
 * the first word with the last.
 *
 * Loose, and only where looseness is safe: the keys are compared against the
 * handful of people a matcher has already confirmed an article is about, and
 * a key two of them share names neither (`matchPeopleByName`). Words are taken
 * as they are spaced, so a hyphenated surname is never cut in half.
 *
 * `_person_name_keys` in the article pipeline is the same rule, so a fact the
 * pipeline keeps as matched is one this links.
 */
export function personNameKeys(name: string): string[] {
  const words = name.split(/\s+/).filter(Boolean);
  const spellings = [name];
  if (words.length > 2) {
    spellings.push([words[0], ...words.slice(2)].join(" "));
    spellings.push([words[0], words.at(-1)].join(" "));
  }
  return [...new Set(spellings.map(normalizePersonName))].filter(Boolean);
}

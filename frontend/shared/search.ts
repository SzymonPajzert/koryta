/** The name index `/api/search` matches against.
 *
 * Firestore has no substring search, so a node carries every prefix of its own
 * name as an array and the query is one `array-contains` against whatever was
 * typed. Prefixes of the whole name are what let "anna n" find Anna Nowak;
 * prefixes of each word are what let "nowak" find her too.
 *
 * Lives here rather than beside the trigger that writes it because the emulator
 * seed has to produce the same index. It did not: the fixture carried a
 * hand-written list of *suffixes* from some earlier scheme, so searching a full
 * name found nobody, and every e2e spec that typed one had been failing on main
 * for as long as anyone had looked. Computed in one place, the two cannot drift
 * again.
 *
 * Whitespace is flattened to single spaces first, because the register hands
 * us names with newlines and tabs in them - a company whose full style runs
 * onto a second line, one person whose name arrived behind a stray tab. Split
 * on the literal space those became one word each with the newline still
 * attached to the front, so „ODPOWIEDZIALNOŚCIĄ” was indexed as
 * „\nodpowiedzialnością” and nothing anybody could type reached it. Thirty
 * names in the database are shaped like that; they pick this up the next time
 * their node is written, the trigger recomputing whatever no longer matches.
 *
 * Each part of a hyphenated word as well, after its first, which is a prefix
 * of the word already: "Bogusława Kupczak-Wiśniowska" is found by
 * "wiśniowska". The register writes a double surname with a space and PKW
 * and Wikipedia with the hyphen, and the person ingest renames a page to the
 * hyphen (`learnsName`) - so a page that "wiśniowska" found under the
 * register's spelling would have stopped being found by it the night it was
 * renamed. Companies are cut the same way, "Wodno-Kanalizacyjne" as much as
 * "Kosiniak-Kamysz": of 2026-10-11, 41 people, 586 companies and 31 regions
 * gain a part, and the index grows by 4,804 chunks over the 777,634 it
 * carried. The parts come after everything else, so a name without a hyphen
 * gets exactly the index it had, in the same order.
 */
export function generateChunksLower(name: string): string[] {
  const chunks: string[] = [""];
  const lowerName = name.trim().replace(/\s+/g, " ").toLowerCase();

  for (let i = 1; i <= lowerName.length; i++) {
    chunks.push(lowerName.substring(0, i));
  }

  const words = lowerName.split(" ");
  if (words.length > 1) {
    for (const word of words) {
      if (word.length > 0) {
        for (let i = 1; i <= word.length; i++) {
          chunks.push(word.substring(0, i));
        }
      }
    }
  }

  for (const word of words) {
    for (const part of word.split("-").slice(1)) {
      for (let i = 1; i <= part.length; i++) {
        chunks.push(part.substring(0, i));
      }
    }
  }

  return Array.from(new Set(chunks));
}

/** The words a typed query is matched by: lowercased, whitespace collapsed.
 * A hyphen typed stays inside its word here, which is what the index holds
 * whole; `nameWords` is where it cuts one.
 *
 * An empty query yields no tokens, which every name answers - that is what
 * makes `/api/search` with no `q` the top of the collection rather than
 * nothing.
 */
export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** The words of a name, or of what was typed, as `nameMatchesTokens` pairs
 * them: lowercased, and cut at hyphens as well as at whitespace.
 *
 * "Kupczak-Wiśniowska" is two words, so "kupczak wiśniowska" finds her as
 * much as the hyphen does, and so does a page still titled the register's
 * way, "Kupczak Wiśniowska", for somebody who types the hyphen. A hyphen
 * standing alone - "Ewa Kukulska - Zając" - is no word at all.
 */
export function nameWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** The one token to spend Firestore's single `array-contains` slot on.
 *
 * The longest one, length being the only proxy for rarity available without
 * counting: a surname typed out in full is usually longer than the given name
 * in front of it, and a query still being typed ends in a fragment shorter
 * than whatever came before it - so mid-word the anchor stays on the word that
 * is already complete. Ties go to the later token, which for a Polish name is
 * the surname: "Piotr Pięta" is worth anchoring on "pięta", a handful of
 * people, rather than "piotr", four hundred of them.
 */
export function anchorToken(tokens: string[]): string {
  let anchor = tokens[0] ?? "";
  for (const token of tokens) {
    if (token.length >= anchor.length) anchor = token;
  }
  return anchor;
}

/** Whether `name` answers every word the searcher typed.
 *
 * Each token has to be the prefix of a *different* word of the name, in any
 * order. That is what makes "andrzej namysło" find Andrzej Józef Namysło - the
 * index cannot, because it only carries prefixes of the whole name and of each
 * word, and the middle name sits between the two words that were typed. Two of
 * every five people in the database have one, so this was most of what anybody
 * typing a name they knew was searching for.
 *
 * Distinct words, so "jan jan" does not find Jan Kowalski by matching the same
 * word twice. Tokens are tried longest first: the most constrained assignment
 * comes out right on the first path in every realistic case, and the search
 * behind it is there to be exact about names like "Janusz Jan" where a greedy
 * pass would take the wrong word and have to give it back.
 *
 * Words on both sides are cut at hyphens too (`nameWords`), so a double
 * surname answers each half typed on its own, the two typed apart, and the
 * two typed with the hyphen - whichever of the two spellings the page has.
 * Nothing that matched stops matching: a typed word that prefixed a
 * hyphenated one, cut at the same hyphens, prefixes it part by part.
 */
export function nameMatchesTokens(name: string, tokens: string[]): boolean {
  const wanted = tokens.flatMap(nameWords);
  if (wanted.length === 0) return true;

  const words = nameWords(name);
  if (wanted.length > words.length) return false;

  const ordered = [...wanted].sort((a, b) => b.length - a.length);
  const taken = words.map(() => false);

  const assign = (i: number): boolean => {
    const token = ordered[i];
    if (token === undefined) return true;
    for (let w = 0; w < words.length; w++) {
      if (taken[w] || !words[w]!.startsWith(token)) continue;
      taken[w] = true;
      if (assign(i + 1)) return true;
      taken[w] = false;
    }
    return false;
  };

  return assign(0);
}

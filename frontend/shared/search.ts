/** Anything that is not part of a word: every character but a letter (with
 * its accents), a digit, whitespace or the hyphen, which the index cuts on its
 * own terms (`generateChunksLower`, `nameWords`). */
const NOT_A_WORD = /[^\p{L}\p{M}\p{N}\s-]+/gu;

/** A name, or what was typed, as the search reads it: composed, lowercased,
 * every run of characters `NOT_A_WORD` matches turned into a space, and the
 * whitespace flattened to single spaces.
 *
 * A word is what somebody can type, and nobody types the punctuation the
 * register writes a name with. Cut at its spaces alone, a name kept that
 * punctuation on the word beside it, and every prefix of the word began with
 * it: „STADNINA KONI "KRASNE"” was indexed under „"krasne"”, so „krasne”
 * found nothing, and „HUTA"KOŚCIUSZKO"” under one word with the quote in the
 * middle. So did „IM.PROF.STANISŁAWA”, „GERIATRII,REUMATOLOGII”, „...DOMARO”
 * and the town in the bracket a company name ends in (`QUALIFIER`). In the
 * 2026-10-28 export 842 company names carry a quote, and searched for by the
 * word in the quotes on 10-27 and 10-28 they read as companies the site did not
 * have.
 *
 * Composed (NFC), so the one name stored with its accents as separate marks,
 * a hospital in Świecie, is found by the letters typed whole. A name with none
 * of this comes out as it always did - trimmed, flattened and lowercased - and
 * so keeps the index it has.
 */
export function searchableText(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(NOT_A_WORD, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The bracket a company or a region name ends in when it says where the
 * thing is rather than what it is called: the town the pipeline appends to a
 * company's register name (`display_name`), the seat that tells two powiats of
 * one name apart, the city of a Warsaw district - 6,587 companies and 25
 * regions of the 2026-10-28 export. Told apart by the small letters a town
 * written out has („(wykreślone)”, the one other bracket with any, is no word
 * anybody searches by). The register's own brackets, „(OPS)”, „(DBFO)”, „(W
 * SKRÓCIE: ... GIWK SP. Z O.O.)”, are what the place is called, and stay words
 * of its name. A person's bracket is never one (`QUALIFIED_TYPES`): „Bartosz
 * Kopania (Pablo Morales)” is found by „morales”.
 *
 * Its words are in the prefixes of the whole name and are matched
 * (`nameWords`), and the index holds them apart from the name's own words,
 * each marked (`townChunk`). A query of one word never asks for them. One of
 * several does, by the word it anchors on, and keeps what answers something
 * besides the town (`reachesBeyondTown`). So „wodociągów myślibórz”, „sanikom
 * lubawka” and „orlen płock” find the companies based there, and „jelenia
 * góra” the town. „chmiel” alone, though, is not answered by GMINNE PRZEDSIĘBIORSTWO
 * KOMUNALNE (Chmielno), which as a word of the name took Piotr Łukasz Chmiel
 * off a logged-out reader's twenty, nor „kraków” by the companies merely based
 * there, which took ARENA KRAKÓW and twelve more off it. Replayed over the
 * 10-28 export, a town indexed as a word of the name took a hit away from 17
 * of the 516 queries typed into the box since 10-15.
 *
 * The old index reached some of these towns by accident - the words of a
 * bracket after its first, „góra)” of „(Jelenia Góra)”, did not begin with a
 * bracket - and a query of one word no longer does.
 */
const QUALIFIER = /\s*\(([^()]*\p{Ll}[^()]*)\)\s*$/u;

/** The node types whose name can end in a `QUALIFIER`. */
const QUALIFIED_TYPES = new Set(["place", "region"]);

/** A name as what it is called and the town its `QUALIFIER` names, the second
 * empty where it has none. */
function splitQualifier(name: string, type?: string): [string, string] {
  const match =
    type !== undefined && QUALIFIED_TYPES.has(type)
      ? QUALIFIER.exec(name)
      : null;
  return match ? [name.slice(0, match.index), match[1]!] : [name, ""];
}

/** What the index puts before each chunk of a town's words, so that nothing
 * typed can ask for one: `searchableText` leaves a query letters, digits and
 * hyphens only. */
const TOWN_MARK = "@";

/** The chunk that asks the index for `chunk` as a word of the town a name's
 * bracket names (`QUALIFIER`). */
export function townChunk(chunk: string): string {
  return TOWN_MARK + chunk;
}

/** The words of a name the index holds by themselves, each with all its
 * prefixes: every word but those of the town in its bracket (`QUALIFIER`),
 * cut as `nameWords` cuts them. What a lookup of one chunk finds a name by. */
export function indexedWords(name: string, type?: string): string[] {
  return nameWords(splitQualifier(name, type)[0]);
}

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
 * their node is written, the trigger recomputing whatever no longer matches
 * (`nameChunksToWrite`).
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
 *
 * The words are the ones `searchableText` leaves, which is how every side of
 * the search cuts a name - the words typed (`searchTokens`) and the check of
 * a hit against them (`nameMatchesTokens`) as much as this index. The quotes
 * and full stops a register name is written with cut a word the way a space
 * does, so „STADNINA KONI "KRASNE"” is found by „krasne”. The town in the
 * bracket a company or region name ends in is cut the same way, but its words
 * come last and marked (`QUALIFIER`), which is why the index needs `type`.
 */
export function generateChunksLower(name: string, type?: string): string[] {
  const chunks: string[] = [""];
  const lowerName = searchableText(name);

  for (let i = 1; i <= lowerName.length; i++) {
    chunks.push(lowerName.substring(0, i));
  }

  const [called, town] = splitQualifier(name, type);
  const words = searchableText(called).split(" ");
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

  for (const word of searchableText(town).split(" ")) {
    for (const part of [word, ...word.split("-").slice(1)]) {
      for (let i = 1; i <= part.length; i++) {
        chunks.push(townChunk(part.substring(0, i)));
      }
    }
  }

  return Array.from(new Set(chunks));
}

/** The index a node of this name should carry, where `stored` is not already
 * exactly it; undefined where it is.
 *
 * Compared on every write rather than only when the name changes, which is
 * how the trigger used to decide: a change to how the index is cut then
 * reached no page that kept its name, so the names flattened above were said
 * to heal on their next write and 32 of the 33 still carried the broken
 * index on 2026-10-11, six weeks after the fix. As exact as the array, order
 * included, so what the trigger writes reads back as nothing to do and its
 * own write ends there.
 */
export function nameChunksToWrite(
  name: string,
  stored: unknown,
  type?: string,
): string[] | undefined {
  const chunks = generateChunksLower(name, type);
  return JSON.stringify(stored) === JSON.stringify(chunks) ? undefined : chunks;
}

/** The words a typed query is matched by: cut the way a name is
 * (`searchableText`), so quotes or a bracket typed around a word are dropped
 * as the index drops them. A hyphen typed stays inside its word here, which
 * is what the index holds whole; `nameWords` is where it cuts one.
 *
 * An empty query yields no tokens, which every name answers - that is what
 * makes `/api/search` with no `q` the top of the collection rather than
 * nothing. So does a query of punctuation alone.
 */
export function searchTokens(query: string): string[] {
  return searchableText(query).split(" ").filter(Boolean);
}

/** The words of a name, or of what was typed, as `nameMatchesTokens` pairs
 * them: cut by `searchableText`, and at hyphens as well as at whitespace.
 *
 * "Kupczak-Wiśniowska" is two words, so "kupczak wiśniowska" finds her as
 * much as the hyphen does, and so does a page still titled the register's
 * way, "Kupczak Wiśniowska", for somebody who types the hyphen. A hyphen
 * standing alone - "Ewa Kukulska - Zając" - is no word at all.
 */
export function nameWords(text: string): string[] {
  return searchableText(text)
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** The KRS number a query is, when it is one written out whole: ten digits,
 * as the register prints it and as anybody copies it from there, with spaces
 * between them allowed and „KRS” in front of them too. Undefined for anything
 * else.
 *
 * Whole, because the box searches while it is typed into: read with its
 * leading zeros left off, „00000297” on its way to „0000029741” would be KRS
 * 297, and the box would offer whichever company that is. A name with a number
 * in it is no KRS number either, which the digits-only rule keeps out.
 */
export function krsNumberQuery(query: string): string | undefined {
  const typed = query
    .trim()
    .replace(/^krs[\s:.#]*/i, "")
    .replace(/\s+/g, "");
  return /^\d{10}$/.test(typed) ? typed : undefined;
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

/** The chunk the second `/api/search` pass asks the index for: the word the
 * searcher typed that `anchorToken` picks, and where that word holds a
 * hyphen, the longest of its parts.
 *
 * Picked among the words as typed, because it is the length of the whole
 * hyphenated word that marks it rare. Picked among the parts instead,
 * "przedsiębiorstwo usługowo-produkcyjne" anchored on "przedsiębiorstwo",
 * which 697 companies of 2026-10-11 carry - more than the 500 the pass
 * reads, so the one asked for fell off the end. Of 2,120 queries made of
 * two or three words of a hyphenated name in that export, 14 lost the page
 * they had found before, and the pass read 148k documents over them; this
 * way it reads 68k and loses none. A part rather than the whole word, so
 * the pass also reaches a page titled with a space, which carries no chunk
 * with a hyphen in it; a page titled with the hyphen carries the part once
 * its index is cut the way `generateChunksLower` cuts it now.
 */
export function anchorChunk(tokens: string[]): string {
  const typed = tokens.filter((token) => nameWords(token).length > 0);
  return anchorToken(nameWords(anchorToken(typed)));
}

/** The chunk `/api/search` asks for after a pass on the anchor came back full:
 * the longest of the other words typed, cut at its hyphens, if it has three
 * letters or more. Undefined where there is none.
 *
 * A full pass is one cut off before its end, and the town of Warsaw holds more
 * companies than one reads: of 1,314 under it in the 2026-10-28 export, 814
 * lie past the 500th. „paged warszawa” anchors on „warszawa”, and the seven
 * PAGED companies based there are as small as companies get, so all but the one
 * whose whole name it is fell past the end. Asked by „paged” too, they are nine
 * reads. Three letters at the least, because one or two are what is typed on
 * the way to a word, and what they ask for is larger still.
 */
export function nextAnchorChunk(tokens: string[]): string | undefined {
  const anchor = anchorChunk(tokens);
  const others = tokens
    .flatMap(nameWords)
    .filter((word) => word !== anchor && word.length >= 3);
  return others.length > 0 ? anchorToken(others) : undefined;
}

/** Whether `tokens` reach a name by more than the town its bracket names
 * (`QUALIFIER`): some word typed begins a word of the name itself.
 *
 * What the town pass of `/api/search` keeps a hit by. It is there for
 * „<the name> <its town>”, and every company based in a town answers the town
 * typed alone - which a town of two words, or one hyphen, is as much as
 * „sanikom lubawka” is two: „jelenia góra” listed 45 companies merely based
 * there, as „kraków” would every one in Kraków.
 */
export function reachesBeyondTown(
  name: string,
  type: string,
  tokens: string[],
): boolean {
  const own = indexedWords(name, type);
  return tokens
    .flatMap(nameWords)
    .some((typed) => own.some((word) => word.startsWith(typed)));
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

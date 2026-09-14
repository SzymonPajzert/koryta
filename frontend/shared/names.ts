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

/** The spelled-out legal forms a register writes in full, and the abbreviation
 * everybody actually uses.
 *
 * Longest first, because „SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA
 * KOMANDYTOWA" ends with „SPÓŁKA KOMANDYTOWA" and matching that one first would
 * leave „... SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ sp.k." behind.
 *
 * Measured over the 32 939 distinct party names in the first CRU window: 27.2%
 * of them end in one of these, 6 804 of them in the 35-character „SPÓŁKA
 * Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" alone. On a phone that suffix is most of a
 * two-line row.
 */
const LEGAL_FORMS: ReadonlyArray<[string, string]> = [
  [
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWO-AKCYJNA",
    "sp. z o.o. S.K.A.",
  ],
  [
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ SPÓŁKA KOMANDYTOWA",
    "sp. z o.o. sp.k.",
  ],
  ["SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "sp. z o.o."],
  ["SPÓŁKA KOMANDYTOWO-AKCYJNA", "S.K.A."],
  ["SPÓŁKA KOMANDYTOWA", "sp.k."],
  ["SPÓŁKA PARTNERSKA", "sp.p."],
  ["SPÓŁKA EUROPEJSKA", "SE"],
  ["SPÓŁKA AKCYJNA", "S.A."],
  ["SPÓŁKA CYWILNA", "s.c."],
  ["SPÓŁKA JAWNA", "sp.j."],
];

/** A company name short enough to read in a list.
 *
 * Only the trailing legal form is touched, and only when the name has something
 * left without it: „SPÓŁKA AKCYJNA" on its own is not a suffix, it is the whole
 * name of nothing, and a register row like that is better shown verbatim than
 * emptied. Nothing else is normalised - not the case, not the quotation marks
 * the register puts around a trading name. The site's own company nodes are
 * ALL CAPS too, because they come from the same registers, so lowercasing here
 * would make a contract row the odd one out rather than the tidy one.
 *
 * The abbreviation is kept rather than dropped. Two companies can differ only
 * by their form, and this site's own names omit it only because api-krs hands
 * `nazwa` and `formaPrawna` over separately - a register that writes them as
 * one string is not telling us the form is noise.
 */
export function companyShortName(name: string | null | undefined): string {
  if (!name) return "";
  const trimmed = name.trim();
  const upper = trimmed.toUpperCase();
  for (const [form, short] of LEGAL_FORMS) {
    if (!upper.endsWith(form)) continue;
    const head = trimmed.slice(0, trimmed.length - form.length).trim();
    // A trailing comma or hyphen belonged to the suffix, not to the name.
    const cleaned = head.replace(/[,\s-]+$/, "");
    if (cleaned) return `${cleaned} ${short}`;
  }
  return trimmed;
}

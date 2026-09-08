/** The vocabulary of personal ties, and what each one is called read the other
 * way round.
 *
 * A `connection` edge carries one free-text word ("żona"), and until now that
 * word was printed on both people's pages - so Anna's page said she was Jan's
 * wife and Jan's page said the same thing about him. The edge now carries two
 * words, `name` and `reverse_name`, and this module is what makes filling in
 * the second one a click rather than a translation exercise: the queue in
 * /admin/relacje has to offer a reverse for every relation already stored.
 *
 * Suggestions, never a rewrite. Half the Polish kinship terms reverse into a
 * pair the stored word cannot choose between - a father's child is a "syn" or
 * a "córka" and the edge says nothing about which - so the first entry is the
 * best guess and the rest are offered beside it. Nothing here decides on its
 * own; a human picks.
 */

/** Grammatical gender of a term, used to re-attach a modifier: the reverse of
 * "była żona" is "były mąż", not "była mąż". Neuter ("dziecko", "rodzeństwo")
 * takes no modifier the site offers, and falls in with the masculine form. */
export type RelationGender = "m" | "f" | "n";

export type RelationTerm = {
  gender: RelationGender;
  /** What the person on the other end is called, best guess first. Empty for a
   * term nobody has worked out a reverse for. */
  reverses: string[];
};

/** Modifiers that survive the flip but have to agree with the reversed noun.
 *
 * Keyed by the masculine form, since that is what a lookup normalizes onto.
 * "były mąż" reversed is "była żona" - the word "były" is part of the claim
 * and dropping it would turn a divorce into a marriage.
 */
const MODIFIERS: { m: string; f: string }[] = [
  { m: "były", f: "była" },
  { m: "obecny", f: "obecna" },
  { m: "przyszły", f: "przyszła" },
  { m: "przybrany", f: "przybrana" },
];

/** Every relation word the queue and the form know how to reverse.
 *
 * Keyed by the normalized term (lowercase, trimmed). Deliberately not an enum
 * on the edge: the field stays free text, because the register of words people
 * actually use for a tie is open - "szara eminencja", "człowiek od kontaktów" -
 * and refusing those would cost more than the tidy vocabulary is worth.
 */
export const RELATION_TERMS: Record<string, RelationTerm> = {
  // --- małżeństwo i związki ---
  żona: { gender: "f", reverses: ["mąż"] },
  mąż: { gender: "m", reverses: ["żona"] },
  małżonka: { gender: "f", reverses: ["małżonek"] },
  małżonek: { gender: "m", reverses: ["małżonka"] },
  narzeczona: { gender: "f", reverses: ["narzeczony"] },
  narzeczony: { gender: "m", reverses: ["narzeczona"] },
  partnerka: { gender: "f", reverses: ["partner", "partnerka"] },
  partner: { gender: "m", reverses: ["partnerka", "partner"] },
  konkubina: { gender: "f", reverses: ["konkubent"] },
  konkubent: { gender: "m", reverses: ["konkubina"] },

  // --- rodzice i dzieci ---
  ojciec: { gender: "m", reverses: ["syn", "córka"] },
  matka: { gender: "f", reverses: ["syn", "córka"] },
  rodzic: { gender: "m", reverses: ["dziecko"] },
  syn: { gender: "m", reverses: ["ojciec", "matka"] },
  córka: { gender: "f", reverses: ["ojciec", "matka"] },
  dziecko: { gender: "n", reverses: ["rodzic"] },
  ojczym: { gender: "m", reverses: ["pasierb", "pasierbica"] },
  macocha: { gender: "f", reverses: ["pasierb", "pasierbica"] },
  pasierb: { gender: "m", reverses: ["ojczym", "macocha"] },
  pasierbica: { gender: "f", reverses: ["ojczym", "macocha"] },

  // --- rodzeństwo ---
  brat: { gender: "m", reverses: ["brat", "siostra"] },
  siostra: { gender: "f", reverses: ["brat", "siostra"] },
  rodzeństwo: { gender: "n", reverses: ["rodzeństwo"] },
  bliźniak: { gender: "m", reverses: ["bliźniak", "bliźniaczka"] },
  bliźniaczka: { gender: "f", reverses: ["bliźniak", "bliźniaczka"] },

  // --- dziadkowie i wnuki ---
  dziadek: { gender: "m", reverses: ["wnuk", "wnuczka"] },
  babcia: { gender: "f", reverses: ["wnuk", "wnuczka"] },
  wnuk: { gender: "m", reverses: ["dziadek", "babcia"] },
  wnuczka: { gender: "f", reverses: ["dziadek", "babcia"] },

  // --- dalsza rodzina ---
  wuj: { gender: "m", reverses: ["siostrzeniec", "siostrzenica"] },
  wujek: { gender: "m", reverses: ["siostrzeniec", "siostrzenica"] },
  stryj: { gender: "m", reverses: ["bratanek", "bratanica"] },
  ciotka: { gender: "f", reverses: ["siostrzeniec", "siostrzenica"] },
  bratanek: { gender: "m", reverses: ["stryj", "ciotka"] },
  bratanica: { gender: "f", reverses: ["stryj", "ciotka"] },
  siostrzeniec: { gender: "m", reverses: ["wuj", "ciotka"] },
  siostrzenica: { gender: "f", reverses: ["wuj", "ciotka"] },
  kuzyn: { gender: "m", reverses: ["kuzyn", "kuzynka"] },
  kuzynka: { gender: "f", reverses: ["kuzyn", "kuzynka"] },

  // --- powinowactwo ---
  teść: { gender: "m", reverses: ["zięć", "synowa"] },
  teściowa: { gender: "f", reverses: ["zięć", "synowa"] },
  zięć: { gender: "m", reverses: ["teść", "teściowa"] },
  synowa: { gender: "f", reverses: ["teść", "teściowa"] },
  szwagier: { gender: "m", reverses: ["szwagier", "szwagierka"] },
  szwagierka: { gender: "f", reverses: ["szwagier", "szwagierka"] },

  // --- poza rodziną ---
  wspólnik: { gender: "m", reverses: ["wspólnik", "wspólniczka"] },
  wspólniczka: { gender: "f", reverses: ["wspólnik", "wspólniczka"] },
  współpracownik: {
    gender: "m",
    reverses: ["współpracownik", "współpracowniczka"],
  },
  współpracowniczka: {
    gender: "f",
    reverses: ["współpracownik", "współpracowniczka"],
  },
  kolega: { gender: "m", reverses: ["kolega", "koleżanka"] },
  koleżanka: { gender: "f", reverses: ["kolega", "koleżanka"] },
  przyjaciel: { gender: "m", reverses: ["przyjaciel", "przyjaciółka"] },
  przyjaciółka: { gender: "f", reverses: ["przyjaciel", "przyjaciółka"] },
  znajomy: { gender: "m", reverses: ["znajomy", "znajoma"] },
  znajoma: { gender: "f", reverses: ["znajomy", "znajoma"] },
  przełożony: { gender: "m", reverses: ["podwładny", "podwładna"] },
  przełożona: { gender: "f", reverses: ["podwładny", "podwładna"] },
  podwładny: { gender: "m", reverses: ["przełożony", "przełożona"] },
  podwładna: { gender: "f", reverses: ["przełożony", "przełożona"] },
  mentor: { gender: "m", reverses: ["podopieczny", "podopieczna"] },
  podopieczny: { gender: "m", reverses: ["mentor", "mentorka"] },
  podopieczna: { gender: "f", reverses: ["mentor", "mentorka"] },
  mentorka: { gender: "f", reverses: ["podopieczny", "podopieczna"] },
  pełnomocnik: { gender: "m", reverses: ["mocodawca"] },
  mocodawca: { gender: "m", reverses: ["pełnomocnik"] },
  asystent: { gender: "m", reverses: ["przełożony", "przełożona"] },
  asystentka: { gender: "f", reverses: ["przełożony", "przełożona"] },
};

/** Lowercased, trimmed, with runs of whitespace collapsed. What the lookup is
 * keyed by, and what two spellings of the same word have to agree on. */
export function normalizeRelationName(name: string | undefined | null): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** A term split from the modifier in front of it, if any.
 *
 * "była żona" is the marriage vocabulary with a tense on it, and the tense has
 * to survive the flip - see `MODIFIERS`.
 */
function splitModifier(normalized: string): {
  modifier?: (typeof MODIFIERS)[number];
  base: string;
} {
  for (const modifier of MODIFIERS) {
    for (const form of [modifier.m, modifier.f]) {
      if (normalized.startsWith(`${form} `)) {
        return { modifier, base: normalized.slice(form.length + 1) };
      }
    }
  }
  return { base: normalized };
}

/** What the other end of a relation called `name` is most likely called, best
 * guess first.
 *
 * Empty for a word the vocabulary has never seen, which is the honest answer:
 * "szara eminencja" has no reverse anybody could derive, and offering a wrong
 * one is worse than offering none.
 */
export function reverseRelationSuggestions(
  name: string | undefined | null,
): string[] {
  const { modifier, base } = splitModifier(normalizeRelationName(name));
  const term = RELATION_TERMS[base];
  if (!term) return [];

  return term.reverses.map((reverse) => {
    if (!modifier) return reverse;
    const gender = RELATION_TERMS[reverse]?.gender ?? "m";
    return `${gender === "f" ? modifier.f : modifier.m} ${reverse}`;
  });
}

/** Whether the relation can read the same in both directions.
 *
 * True where the word is among its own reverses - "wspólnik" and "wspólnik",
 * "brat" and "brat", "wspólniczka" and "wspólniczka". A father is not
 * symmetric however the child is named, and neither is a wife.
 *
 * Not the same question as "is the first suggestion the same word": the best
 * guess for "wspólniczka" is the masculine "wspólnik", because that is what
 * the other end is more often called, and the tie is symmetric all the same.
 */
export function isSymmetricRelation(name: string | undefined | null): boolean {
  const { base } = splitModifier(normalizeRelationName(name));
  const term = RELATION_TERMS[base];
  if (!term) return false;
  return term.reverses.some(
    (reverse) => normalizeRelationName(reverse) === base,
  );
}

/** Whether this relation still owes the site its other side.
 *
 * Only `connection` edges: every other type reads differently on each end by
 * construction - an `employed` prints the job title whichever page it is on,
 * and "Zatrudniony/a w" versus "zatrudniał/a" is decided by the type, not by
 * anything stored. And only where there is a word to reverse: an unnamed
 * connection falls back to "Powiązanie z" on both pages, which is already
 * symmetric and true.
 */
export function relationNeedsReverse(edge: {
  type?: string;
  name?: string | null;
  reverse_name?: string | null;
}): boolean {
  if (edge.type !== "connection") return false;
  if (!edge.name || !edge.name.trim()) return false;
  return !edge.reverse_name || !edge.reverse_name.trim();
}

/** Daily "Po jakich studiach?": an anonymous CV, and one question.
 *
 * The player types what they think the person studied and is answered the way
 * Contexto answers: not right/wrong, but *where their answer sits* in a list of
 * every term the game knows, ordered by closeness to the real one. "stolarz"
 * against a target of magister budownictwa comes back #340; "technik
 * budowlany" comes back #24; #1 ends the day. Guesses are unlimited and the
 * score is how many were spent.
 *
 * WHY NOT EMBEDDINGS. Contexto orders its vocabulary by cosine distance
 * between word vectors. This repo has no embedding infrastructure at all - no
 * model, no vector store, and no LLM credentials on the deployed backend - so
 * ordering here is assembled out of three cheap signals that between them
 * behave enough like one:
 *
 *   FIELD - every term carries the field it belongs to as a path through a
 *     tree, and two terms are close in proportion to how much of that path
 *     they share. Across the top of the tree, where no path is shared at all,
 *     an authored affinity table says how near two areas stand: law is nearer
 *     to economics than to welding, and being told otherwise is what makes a
 *     ranking read as broken.
 *   LEVEL - how far apart two terms sit on the ladder from podstawowe to
 *     profesor. The tie-break that turns a cluster into an order.
 *   MORPHOLOGY - character-trigram overlap between the two terms once their
 *     level words are stripped. "technik budowlany" and "magister inżynier
 *     budownictwa" share budow-; nothing in the tree had to say so.
 *
 * That is a smaller idea than an embedding, and it buys back the thing the
 * embedding was chosen for. `education` on a node is free prose precisely
 * because the useful answer is sometimes a degree and sometimes a formation no
 * degree scale covers - "duchowny prawosławny" - and a *parse* of that prose
 * into facets is what would have to reject it. Nothing is parsed here. A term
 * is a row somebody wrote down with its field and level already on it, so
 * "duchowny prawosławny" is an ordinary entry that ranks ksiądz and teologia
 * next to it, and it makes a perfectly good daily.
 *
 * WHY THREE SIGNALS AND NOT ONE. The first cut of this file scored on field
 * and level alone, and it did not work: over the vocabulary of the day the two
 * of them together took only 19 distinct values, so half the list was tied
 * with itself and the rank a player was shown came from the alphabet rather
 * than from anything about their answer. Two terms in the same corner of the
 * tree at the same level are genuinely equally close in the tree - the tree has
 * nothing left to say about them - and the morphology is what separates them
 * without anybody having to author a distance for every pair.
 *
 * The cost is that a target has to be IN the vocabulary to be asked about, and
 * the prose on the node has to resolve to it - which is what `aliases` and the
 * abbreviation folding in `educationNormalizedKey` are for. A person whose
 * education resolves to nothing is left out of the pool rather than guessed at.
 */

/** How far up the ladder a term sits.
 *
 * An ordinal, not a hierarchy of worth: it exists so that "technik budowlany"
 * and "magister budownictwa" can be near each other in field and still be
 * told apart, which is most of what makes the feedback playable. `formacja`
 * is the escape hatch for the qualifications no ladder holds - a religious
 * formation, an officer's commission, a mistrz's papers - and it sits outside
 * the order rather than being squeezed into it.
 */
export const educationLevels = [
  "podstawowe",
  "zasadnicze zawodowe",
  "średnie",
  "policealne",
  "licencjat",
  "magister",
  "doktor",
  "profesor",
  "formacja",
] as const;

export type EducationLevel = (typeof educationLevels)[number];

/** Levels compared as positions on a ladder. `formacja` is deliberately not on
 * it: comparing a religious formation to a master's degree by height is a
 * judgement nobody asked this game to make, so it scores as level-neutral
 * against everything except another formation. */
const levelRank: Record<EducationLevel, number | null> = {
  podstawowe: 0,
  "zasadnicze zawodowe": 1,
  średnie: 2,
  policealne: 3,
  licencjat: 4,
  magister: 5,
  doktor: 6,
  profesor: 7,
  formacja: null,
};

/** The rungs of the ladder, i.e. every level except the one that is off it.
 * The widest possible gap, which is what a level distance is measured against. */
const levelSpan = educationLevels.length - 2;

/** The top level of the field tree. Every term's `path[0]` is one of these.
 *
 * A closed set on purpose. The whole of the cross-area distance below is
 * authored against these names, so a fifteenth area invented in the vocabulary
 * would sit at the floor distance from all fourteen others - which reads to a
 * player as the game being broken, and is exactly the failure the affinity
 * table exists to prevent. Adding one means adding its row here too.
 */
export const educationAreas = [
  "prawnicze",
  "ekonomiczne",
  "techniczne",
  "informatyczne",
  "przyrodnicze",
  "rolnicze",
  "medyczne",
  "humanistyczne",
  "społeczne",
  "pedagogiczne",
  "artystyczne",
  "mundurowe",
  "duchowieństwo",
  "rzemieślnicze",
] as const;

export type EducationArea = (typeof educationAreas)[number];

/** How near two top-level areas stand, in [0, 1], where 1 would be the same
 * area and 0 is nothing whatever in common.
 *
 * Written out by hand because there is no way to derive it: it is a claim
 * about which fields a Polish CV moves between, not about the words. Read it
 * as "a player who guessed here has half a point" - law and administration
 * share careers, technical and trades share workshops, humanities and
 * theology share a faculty. Only one direction of each pair is listed;
 * `areaAffinity` symmetrises it. Pairs left out score `AREA_FLOOR`.
 */
const areaAffinities: Partial<
  Record<EducationArea, Partial<Record<EducationArea, number>>>
> = {
  prawnicze: {
    ekonomiczne: 0.45,
    społeczne: 0.5,
    humanistyczne: 0.3,
    mundurowe: 0.4,
    duchowieństwo: 0.25,
    pedagogiczne: 0.2,
    techniczne: 0.1,
    informatyczne: 0.1,
    medyczne: 0.1,
    artystyczne: 0.1,
  },
  ekonomiczne: {
    społeczne: 0.4,
    informatyczne: 0.3,
    techniczne: 0.25,
    rolnicze: 0.25,
    rzemieślnicze: 0.25,
    humanistyczne: 0.2,
    pedagogiczne: 0.2,
    mundurowe: 0.15,
    medyczne: 0.1,
    przyrodnicze: 0.1,
    artystyczne: 0.1,
  },
  techniczne: {
    informatyczne: 0.6,
    rzemieślnicze: 0.55,
    przyrodnicze: 0.4,
    rolnicze: 0.3,
    mundurowe: 0.25,
    artystyczne: 0.2,
    medyczne: 0.15,
    pedagogiczne: 0.15,
    społeczne: 0.1,
  },
  informatyczne: {
    przyrodnicze: 0.35,
    rzemieślnicze: 0.2,
    artystyczne: 0.2,
    społeczne: 0.15,
    pedagogiczne: 0.15,
    mundurowe: 0.15,
    medyczne: 0.1,
    humanistyczne: 0.1,
    rolnicze: 0.1,
  },
  przyrodnicze: {
    medyczne: 0.5,
    rolnicze: 0.5,
    pedagogiczne: 0.3,
    humanistyczne: 0.15,
    społeczne: 0.15,
    rzemieślnicze: 0.1,
    mundurowe: 0.1,
  },
  rolnicze: {
    rzemieślnicze: 0.35,
    medyczne: 0.25,
    pedagogiczne: 0.15,
    społeczne: 0.1,
    mundurowe: 0.1,
  },
  medyczne: {
    społeczne: 0.3,
    pedagogiczne: 0.2,
    mundurowe: 0.2,
    rzemieślnicze: 0.15,
    duchowieństwo: 0.1,
  },
  humanistyczne: {
    społeczne: 0.55,
    pedagogiczne: 0.5,
    artystyczne: 0.45,
    duchowieństwo: 0.4,
    mundurowe: 0.1,
  },
  społeczne: {
    pedagogiczne: 0.45,
    artystyczne: 0.25,
    duchowieństwo: 0.25,
    mundurowe: 0.2,
  },
  pedagogiczne: {
    artystyczne: 0.3,
    duchowieństwo: 0.3,
    rzemieślnicze: 0.15,
    mundurowe: 0.15,
  },
  artystyczne: { rzemieślnicze: 0.3, duchowieństwo: 0.15 },
  mundurowe: { rzemieślnicze: 0.2, duchowieństwo: 0.1 },
};

/** What two areas nobody wrote a number for are worth. Not zero: a player who
 * guessed a formation at all is nearer than a player who guessed nothing, and
 * a floor keeps the very bottom of the list from being one undifferentiated
 * slab of everything. */
const AREA_FLOOR = 0.05;

const areaAffinityIndex = (() => {
  const index = new Map<string, number>();
  const key = (a: string, b: string) => `${a} ${b}`;
  for (const [from, row] of Object.entries(areaAffinities)) {
    for (const [to, value] of Object.entries(row)) {
      index.set(key(from, to), value);
      index.set(key(to, from), value);
    }
  }
  return index;
})();

function areaAffinity(a: string, b: string): number {
  if (a === b) return 1;
  return areaAffinityIndex.get(`${a} ${b}`) ?? AREA_FLOOR;
}

export interface EducationTerm {
  /** What the player types and what the reveal prints. */
  term: string;
  level: EducationLevel;
  /** Where the term sits in the field tree, general to specific:
   * ["techniczne", "budownictwo", "konstrukcje"]. The shared prefix of two
   * paths is the whole of the field distance between them, so depth is not
   * decoration - a two-segment path is a term the tree can say less about. */
  path: string[];
  /** Other ways the same thing is written, so that a node whose prose says
   * "mgr prawa" and a player who types "prawnik" both land on this row.
   * Matched case- and space-insensitively, and again after the abbreviation
   * folding in `educationNormalizedKey`. */
  aliases?: string[];
}

/** How close two terms are, in [0, 1].
 *
 * Field first and by a long way: a player who has worked out the person is a
 * lawyer has done the hard part, and being told that "radca prawny" is miles
 * from "magister prawa" because of a level would be a lie about what they
 * know. The level orders the ladder inside a field. The morphology separates
 * what the other two leave tied - see the note at the top of the file.
 */
const FIELD_WEIGHT = 0.6;
const LEVEL_WEIGHT = 0.18;
const SHAPE_WEIGHT = 0.22;

/** Words that say what rung a term sits on rather than what it is about.
 *
 * Stripped before the trigrams are taken, because leaving them in would score
 * "magister prawa" against "magister budownictwa" as similar for having the
 * word magister in common - which is the level talking, and the level is
 * already its own term in the sum. What is left is the part of the phrase that
 * carries the field. */
const shapeStopWords = new Set([
  "magister",
  "mgr",
  "inżynier",
  "inż",
  "licencjat",
  "licencjonowany",
  "technik",
  "tech",
  "techn",
  "doktor",
  "dr",
  "habilitowany",
  "hab",
  "profesor",
  "prof",
  "starszy",
  "st",
  "młodszy",
  "mistrz",
  "czeladnik",
  "dyplomowany",
  "dyplomowana",
  "nauk",
  "w",
  "i",
  "z",
  "do",
  "na",
  "o",
  "ds",
]);

/** The part of a term the trigrams are taken from: its words minus the ones
 * that only say how high up it sits. Falls back to the whole term when
 * stripping would leave nothing, so "magister" alone still compares as
 * something. */
function shapeOf(term: string): string {
  const words = educationKey(term)
    .replace(/[.,()/-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !shapeStopWords.has(word));
  const shape = words.join(" ");
  return shape || educationKey(term);
}

/** What the trigrams are taken over: the term, plus the lower segments of its
 * path.
 *
 * The path words are in for the sake of the terms that are one short word -
 * "imam", "rabin", "bosman" - which share no trigram with most of the list and
 * would otherwise sit in one enormous tie with everything they are unrelated
 * to. The dziedzina and the specialisation are words a human wrote about the
 * same thing, so they carry the same morphology at no extra cost. The area is
 * left off: every term in an area repeats it, so it would add a constant.
 */
function phraseOf(entry: Pick<EducationTerm, "term" | "path">): string {
  return [entry.term, ...entry.path.slice(1)].join(" ");
}

/** Trigrams of a phrase, padded so that short words still produce some.
 * Memoised: a rank is a scan of the whole vocabulary and the same trigram sets
 * are wanted on every guess of the day. */
const trigramCache = new Map<string, Set<string>>();

function trigrams(value: string): Set<string> {
  const cached = trigramCache.get(value);
  if (cached) return cached;
  const padded = `  ${value} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    set.add(padded.slice(i, i + 3));
  }
  trigramCache.set(value, set);
  return set;
}

/** Sørensen-Dice over those trigrams, in [0, 1]. Cheap, symmetric, and it
 * rewards a shared stem ("budow-", "prawn-", "roln-") without anybody having
 * to write the stem down. */
function shapeSimilarity(a: string, b: string): number {
  const left = trigrams(shapeOf(a));
  const right = trigrams(shapeOf(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return (2 * shared) / (left.size + right.size);
}

/** How much of the field tree two terms have in common, in [0, 1].
 *
 * Inside a shared branch this is Wu-Palmer: twice the shared depth over the
 * two depths together, so ["techniczne","budownictwo","konstrukcje"] against
 * ["techniczne","budownictwo","drogi"] scores 4/6 and against
 * ["techniczne","mechanika","pojazdy"] scores 2/6. Outside one it is the
 * authored affinity between the two areas, scaled to sit strictly below the
 * weakest possible in-branch score - sharing an area must always beat not
 * sharing one, however friendly the two areas are.
 */
const AREA_SCALE = 0.5;

export function fieldSimilarity(
  a: readonly string[],
  b: readonly string[],
): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared++;
  }
  if (shared > 0) return (2 * shared) / (a.length + b.length);
  return AREA_SCALE * areaAffinity(a[0] ?? "", b[0] ?? "");
}

export function educationSimilarity(
  a: Pick<EducationTerm, "term" | "level" | "path">,
  b: Pick<EducationTerm, "term" | "level" | "path">,
): number {
  const field = fieldSimilarity(a.path, b.path);

  const rankA = levelRank[a.level];
  const rankB = levelRank[b.level];
  /** A formation compared with anything on the ladder is level-neutral rather
   * than maximally distant - see `levelRank`. Two formations are level-equal,
   * because being off the ladder is itself something they share. */
  const level =
    rankA === null && rankB === null
      ? 1
      : rankA === null || rankB === null
        ? 0.5
        : 1 - Math.abs(rankA - rankB) / levelSpan;

  const shape = shapeSimilarity(phraseOf(a), phraseOf(b));

  return FIELD_WEIGHT * field + LEVEL_WEIGHT * level + SHAPE_WEIGHT * shape;
}

/** A term as it is looked up: case folded, spaces collapsed. Deliberately not
 * accent-folded - "łaciński" and "lacinski" are the same word to a player, but
 * folding would also merge terms that differ only by an accent, and Polish has
 * enough of those to make that a real risk for a two-line saving. */
export function educationKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The abbreviations Polish records are actually written in.
 *
 * Applied word by word, never to the middle of a word, so this stays a lookup
 * and not a parse: "inż.mechanik" is two words somebody typed without a space,
 * and expanding the first of them is spelling, not interpretation. It matters
 * because the prose these terms have to resolve against - candidate lists,
 * hand-typed node fields - is full of "mgr inż.", "tech.rolnik", "lek. med."
 * and would otherwise take those people out of the pool.
 */
const abbreviations: Record<string, string> = {
  mgr: "magister",
  inz: "inżynier",
  inż: "inżynier",
  tech: "technik",
  techn: "technik",
  dr: "doktor",
  hab: "habilitowany",
  prof: "profesor",
  lek: "lekarz",
  med: "medycyny",
  wet: "weterynarii",
  st: "starszy",
  mł: "młodszy",
  spec: "specjalista",
  ekon: "ekonomista",
  nauczyc: "nauczyciel",
  wyzsze: "wyższe",
};

/** The second key a term is filed under: the strict key with the dots opened
 * out into spaces and every abbreviation expanded. `educationKey` stays the
 * primary, so an exact spelling always wins over a folded one. */
export function educationNormalizedKey(value: string): string {
  return educationKey(value)
    .replace(/[.,/]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => abbreviations[word] ?? word)
    .join(" ");
}

/** Every way a vocabulary can be addressed: its own term, all its aliases, and
 * the abbreviation-folded form of each. */
export function educationIndex(
  vocabulary: readonly EducationTerm[],
): Map<string, EducationTerm> {
  const index = new Map<string, EducationTerm>();
  // Strict keys are registered for the whole vocabulary before any folded one,
  // so a folded spelling of one term can never shadow another term's own name.
  for (const entry of vocabulary) {
    for (const name of [entry.term, ...(entry.aliases ?? [])]) {
      const key = educationKey(name);
      // First writer wins, so a later entry cannot silently steal an alias
      // that an earlier one depends on for its own targets to resolve.
      if (!index.has(key)) index.set(key, entry);
    }
  }
  for (const entry of vocabulary) {
    for (const name of [entry.term, ...(entry.aliases ?? [])]) {
      const key = educationNormalizedKey(name);
      if (!index.has(key)) index.set(key, entry);
    }
  }
  return index;
}

/** Look a written form up: exactly as spelled first, then with abbreviations
 * folded. Everything that resolves prose to a term goes through here, so the
 * player's autocomplete pick and the node's hand-typed field are read the same
 * way. */
export function educationLookup(
  index: ReadonlyMap<string, EducationTerm>,
  value: string,
): EducationTerm | undefined {
  return (
    index.get(educationKey(value)) ?? index.get(educationNormalizedKey(value))
  );
}

/** Where a guess sits against the target, counting from 1.
 *
 * The answer is pinned to #1 outright rather than being allowed to fall out of
 * the arithmetic. Two terms can still score identically - "adwokat" and "radca
 * prawny" differ in neither field, level nor stem - and a player who typed the
 * right one must not be told #2 because its twin sorts first.
 *
 * Everything else breaks the remaining ties on the term, so the number is
 * stable: two equally close answers must not swap places between one guess and
 * the next, or a player watching the rank move is reading noise. Which of a
 * tied pair comes first is arbitrary, but it is arbitrary in the same way
 * every time.
 */
export function educationRank(
  vocabulary: readonly EducationTerm[],
  target: EducationTerm,
  guess: EducationTerm,
): number {
  if (guess.term === target.term) return 1;
  const score = educationSimilarity(target, guess);
  let ahead = 1; // the answer itself
  for (const entry of vocabulary) {
    if (entry.term === guess.term || entry.term === target.term) continue;
    const other = educationSimilarity(target, entry);
    if (other > score) ahead++;
    else if (other === score && entry.term.localeCompare(guess.term) < 0) {
      ahead++;
    }
  }
  return ahead + 1;
}

/** How a rank reads next to the number, so the scale is legible from the first
 * guess rather than after the tenth. Contexto's own tell: the word does the
 * work, the number does the ordering.
 *
 * Read as fractions of the vocabulary with a flat top: the top ten are "bardzo
 * blisko" however long the list is, because at that point the player is inside
 * one dziedzina and the number itself is the interesting part. The bands below
 * are shares, so they keep meaning the same thing as the vocabulary grows -
 * which it is meant to. `educationTemperatureBands` exists so a test can hold
 * the file to that: at the shipped size every band has to be reachable, and
 * an earlier cut of this function had one that was not.
 */
export function educationTemperature(rank: number, total: number): string {
  if (rank === 1) return "trafione";
  const share = rank / Math.max(total, 1);
  if (rank <= 10) return "bardzo blisko";
  if (share <= 0.03) return "blisko";
  if (share <= 0.12) return "ciepło";
  if (share <= 0.4) return "chłodno";
  return "zimno";
}

/** Every word `educationTemperature` can answer with, coldest last. */
export const educationTemperatureBands = [
  "trafione",
  "bardzo blisko",
  "blisko",
  "ciepło",
  "chłodno",
  "zimno",
] as const;

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
 * ordering here comes from the vocabulary itself: every term carries the field
 * it belongs to, as a path through a tree, and the level it sits at. Closeness
 * is how much of that path two terms share, plus how far apart their levels
 * are.
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
 * The cost is that a target has to be IN the vocabulary to be asked about, and
 * the prose on the node has to resolve to it - which is what `aliases` is for.
 * A person whose education resolves to nothing is left out of the pool rather
 * than guessed at.
 */

/** How far up the ladder a term sits.
 *
 * An ordinal, not a hierarchy of worth: it exists so that "technik budowlany"
 * and "magister budownictwa" can be near each other in field and still be
 * told apart, which is most of what makes the feedback playable. `formacja`
 * is the escape hatch for the qualifications no ladder holds - a religious
 * formation, an officer's commission - and it sits outside the order rather
 * than being squeezed into it.
 */
export const educationLevels = [
  "podstawowe",
  "zasadnicze zawodowe",
  "średnie",
  "licencjat",
  "magister",
  "doktor",
  "formacja",
] as const;

export type EducationLevel = (typeof educationLevels)[number];

/** Levels compared as positions on a ladder. `formacja` is deliberately not on
 * it: comparing a religious formation to a master's degree by height is a
 * judgement nobody asked this game to make, so it scores as level-neutral. */
const levelRank: Record<EducationLevel, number | null> = {
  podstawowe: 0,
  "zasadnicze zawodowe": 1,
  średnie: 2,
  licencjat: 3,
  magister: 4,
  doktor: 5,
  formacja: null,
};

export interface EducationTerm {
  /** What the player types and what the reveal prints. */
  term: string;
  level: EducationLevel;
  /** Where the term sits in the field tree, general to specific:
   * ["techniczne", "budownictwo"]. The shared prefix of two paths is the whole
   * of the field distance between them. */
  path: string[];
  /** Other ways the same thing is written, so that a node whose prose says
   * "mgr prawa" and a player who types "prawnik" both land on this row.
   * Matched case- and space-insensitively. */
  aliases?: string[];
}

/** How close two terms are, in [0, 1].
 *
 * Field first and by a long way: a player who has worked out the person is a
 * lawyer has done the hard part, and being told that "radca prawny" is miles
 * from "magister prawa" because of a level would be a lie about what they
 * know. The level is the tie-break that turns a cluster into an order.
 */
const FIELD_WEIGHT = 0.75;
const LEVEL_WEIGHT = 0.25;

export function educationSimilarity(
  a: Pick<EducationTerm, "level" | "path">,
  b: Pick<EducationTerm, "level" | "path">,
): number {
  const depth = Math.max(a.path.length, b.path.length, 1);
  let shared = 0;
  while (
    shared < a.path.length &&
    shared < b.path.length &&
    a.path[shared] === b.path[shared]
  ) {
    shared++;
  }
  const field = shared / depth;

  const rankA = levelRank[a.level];
  const rankB = levelRank[b.level];
  /** A formation compared with anything is level-neutral rather than maximally
   * distant - see `levelRank`. Half, so it neither helps nor punishes. */
  const level =
    rankA === null || rankB === null
      ? 0.5
      : 1 - Math.abs(rankA - rankB) / (educationLevels.length - 2);

  return FIELD_WEIGHT * field + LEVEL_WEIGHT * level;
}

/** A term as it is looked up: case folded, spaces collapsed. Deliberately not
 * accent-folded - "łaciński" and "lacinski" are the same word to a player, but
 * folding would also merge terms that differ only by an accent, and Polish has
 * enough of those to make that a real risk for a two-line saving. */
export function educationKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every way a vocabulary can be addressed: its own term and all its aliases. */
export function educationIndex(
  vocabulary: readonly EducationTerm[],
): Map<string, EducationTerm> {
  const index = new Map<string, EducationTerm>();
  for (const entry of vocabulary) {
    for (const name of [entry.term, ...(entry.aliases ?? [])]) {
      const key = educationKey(name);
      // First writer wins, so a later entry cannot silently steal an alias
      // that an earlier one depends on for its own targets to resolve.
      if (!index.has(key)) index.set(key, entry);
    }
  }
  return index;
}

/** Where a guess sits against the target, counting from 1.
 *
 * Exact ties are the norm here rather than the exception, and that is the one
 * place this ordering behaves unlike an embedding's. "adwokat", "radca prawny"
 * and "magister prawa" share a level and a path, so they are all exactly as
 * close to each other as it is possible to be. Two things follow.
 *
 * The answer is pinned to #1 outright. Otherwise a player who typed the right
 * term would be told #2 because a synonym sorts ahead of it alphabetically,
 * which is the game calling a correct answer wrong.
 *
 * Everything else breaks ties on the term, so the number is stable: two
 * equally close answers must not swap places between one guess and the next,
 * or a player watching the rank move is reading noise. Which of a tied cluster
 * comes first is arbitrary, but it is arbitrary in the same way every time.
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
 * work, the number does the ordering. */
export function educationTemperature(rank: number, total: number): string {
  if (rank === 1) return "trafione";
  const share = rank / Math.max(total, 1);
  if (rank <= 10) return "bardzo blisko";
  if (share <= 0.05) return "blisko";
  if (share <= 0.2) return "ciepło";
  if (share <= 0.5) return "chłodno";
  return "zimno";
}

/** Daily "Po jakich studiach?": the shapes the two routes and the page share.
 *
 * The ranking itself lives in `education.ts` and the terms in
 * `educationVocabulary.ts`; this is only the wire format. Note what is NOT in
 * `StudiaPuzzle`: the answer. A Contexto-style rank has to be computed against
 * the target, so it is computed on the server, one request per guess - which
 * is also why the puzzle carries `vocabularySize` rather than the vocabulary.
 */

export const studiaSlug = "studia";

/** How many career entries a person needs before they can be asked about.
 *
 * Three is the point at which a CV starts to have a shape - a sector, a
 * direction, a decade - rather than being one fact. Below it the game is a
 * guess about a stranger, which is the failure mode the whole design is
 * arranged to avoid. */
export const studiaMinCvEntries = 3;

/** One line of the anonymous CV. */
export interface StudiaCvEntry {
  kind: "praca" | "wybory";
  /** The employer as a branża, or the office stood for. Never a name. */
  what: string;
  /** The seat, or the district - context that does not identify. */
  role: string;
  from: string | null;
  to: string | null;
  party?: string;
}

export interface StudiaPuzzle {
  date: string;
  number: number;
  cv: StudiaCvEntry[];
  /** Every term the game can be answered with, for the autocomplete. Sending
   * the list is safe and sending the *order* is not: the order against the
   * target is the answer, which is why ranking is a request. */
  terms: string[];
  vocabularySize: number;
}

/** What one guess comes back as. */
export interface StudiaGuessResult {
  term: string;
  rank: number;
  total: number;
  temperature: string;
  /** Set only on the winning guess - this is the first and only time the
   * server says the answer out loud. */
  solved: boolean;
  personName?: string;
  personId?: string;
}

/** The square a finished game contributes to its share card: how many guesses
 * it took, bucketed so the grid stays legible at emoji size. */
export function studiaSquares(guesses: number): string {
  if (guesses <= 3) return "🟩🟩🟩";
  if (guesses <= 8) return "🟩🟩⬜";
  if (guesses <= 20) return "🟩⬜⬜";
  return "⬜⬜⬜";
}

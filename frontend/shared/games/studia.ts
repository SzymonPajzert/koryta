/** Daily "Po jakich studiach?": the wire format, and the daily pick.
 *
 * The ranking itself lives in `education.ts` and the terms in
 * `educationVocabulary.ts`. Here are the shapes the two routes and the page
 * share, and - below them - the pick: who is asked about today and what their
 * anonymous CV reads as.
 *
 * Note what is NOT in `StudiaPuzzle`: the answer. A Contexto-style rank has to
 * be computed against the target, so it is computed on the server, one request
 * per guess - which is also why the puzzle carries `vocabularySize` rather
 * than the vocabulary.
 *
 * The pick lives in this module rather than in `server/utils/studia.ts`
 * because a pick nobody can test is a pick nobody can change: everything below
 * takes plain records and returns plain records, so the eligibility rules are
 * exercised in the unit suite without a Firestore. The server util is what
 * reads the collections and hands them over.
 */

import { pickRotating, puzzleNumber } from "./engine";
import { gameEntry } from "./registry";
import { branzaFromCompany } from "./korytle";
import { educationLookup, type EducationTerm } from "./education";

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

/** Everything the daily pick needs to know about a person node. Structural on
 * purpose: the pool is built in this module so it can be tested without a
 * Firestore, and it should not have to know what a node looks like beyond the
 * five fields it reads. */
export interface StudiaPersonLike {
  id?: string;
  name?: string;
  visibility?: boolean;
  deleted?: boolean;
  education?: string;
}

/** The same for the two node kinds a CV line is drawn from. */
export interface StudiaPlaceLike {
  visibility?: boolean;
  deleted?: boolean;
  activity?: unknown;
  categories?: unknown;
}

export interface StudiaRegionLike {
  name?: string;
}

export interface StudiaEdgeLike {
  type?: string;
  source?: string;
  target?: string;
  name?: string;
  visibility?: boolean;
  deleted?: boolean;
  start_date?: string;
  end_date?: string;
  party?: string;
  position?: string;
}

/** Who today's anonymous CV belongs to, and what they studied.
 *
 * The target never leaves the server. The CV route returns the career and the
 * guess route returns a rank, and neither ever puts the term in a payload
 * until the day is won; that is the whole reason a guess costs a request
 * rather than being scored in the browser off a shipped vocabulary.
 */
export interface StudiaTarget {
  personId: string;
  personName: string;
  term: EducationTerm;
  cv: StudiaCvEntry[];
}

/** A person is only asked about if their CV is worth reading.
 *
 * The premise of the game is that a career leaks what somebody studied, and a
 * career of one line leaks nothing - that is a coin flip dressed up as a
 * deduction. See `studiaMinCvEntries`.
 */
export function studiaUsableCv(cv: StudiaCvEntry[]): boolean {
  return cv.length >= studiaMinCvEntries;
}

/** Everybody whose education resolves to a term the game can rank.
 *
 * The field is free prose by design, so this is a lookup and never a parse:
 * prose that no alias covers takes the person out of the pool rather than
 * being guessed at. Adding the alias is how such a person gets back in.
 */
export function studiaCandidates(
  people: Iterable<StudiaPersonLike>,
  index: ReadonlyMap<string, EducationTerm>,
): { id: string; name: string; term: EducationTerm }[] {
  const candidates: { id: string; name: string; term: EducationTerm }[] = [];
  for (const person of people) {
    if (!person.id || !person.name || !person.visibility || person.deleted) {
      continue;
    }
    if (!person.education?.trim()) continue;
    const term = educationLookup(index, person.education);
    if (!term) continue;
    candidates.push({ id: person.id, name: person.name, term });
  }
  return candidates;
}

/** The anonymous CV of everybody in `eligible`, oldest line first.
 *
 * An employer is reduced to its branża and an election to its office: the name
 * of either is a search away from the person, and the person's page prints the
 * answer.
 */
export function studiaCvs(
  edges: Iterable<StudiaEdgeLike>,
  eligible: ReadonlySet<string>,
  places: Record<string, StudiaPlaceLike | undefined>,
  regions: Record<string, StudiaRegionLike | undefined>,
): Map<string, StudiaCvEntry[]> {
  const cvs = new Map<string, StudiaCvEntry[]>();
  const push = (id: string, entry: StudiaCvEntry) => {
    const list = cvs.get(id);
    if (list) list.push(entry);
    else cvs.set(id, [entry]);
  };

  for (const edge of edges) {
    if (!edge.visibility || edge.deleted) continue;
    if (!edge.source || !eligible.has(edge.source)) continue;

    if (edge.type === "employed") {
      const place = edge.target ? places[edge.target] : undefined;
      if (!place?.visibility || place.deleted) continue;
      push(edge.source, {
        kind: "praca",
        what: branzaFromCompany(place.activity, place.categories),
        role: edge.name ?? "",
        from: edge.start_date?.slice(0, 4) ?? null,
        to: edge.end_date?.slice(0, 4) ?? null,
      });
    } else if (edge.type === "election") {
      const region = edge.target ? regions[edge.target] : undefined;
      push(edge.source, {
        kind: "wybory",
        what: edge.position ?? edge.name ?? "Wybory",
        role: region?.name ? `okręg: ${region.name}` : "",
        from: edge.start_date?.slice(0, 4) ?? null,
        to: null,
        party: edge.party || undefined,
      });
    }
  }

  for (const cv of cvs.values()) {
    cv.sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
  }
  return cvs;
}

/** Today's target, or null on a day with nobody to ask about.
 *
 * Both routes of this game need the same answer to that question - the one
 * that serves the CV and the one that ranks a guess - and they must not be
 * able to disagree, so the pick lives here rather than in either of them.
 */
export function pickStudiaTarget(
  people: Iterable<StudiaPersonLike>,
  edges: Iterable<StudiaEdgeLike>,
  places: Record<string, StudiaPlaceLike | undefined>,
  regions: Record<string, StudiaRegionLike | undefined>,
  index: ReadonlyMap<string, EducationTerm>,
  day: string,
): StudiaTarget | null {
  const candidates = studiaCandidates(people, index);
  if (candidates.length === 0) return null;

  const eligible = new Set(candidates.map((candidate) => candidate.id));
  const cvs = studiaCvs(edges, eligible, places, regions);

  const pool = candidates
    .map((candidate) => ({ ...candidate, cv: cvs.get(candidate.id) ?? [] }))
    .filter((candidate) => studiaUsableCv(candidate.cv));
  if (pool.length === 0) return null;

  // Dealt rather than drawn - see `pickRotating`. With a pool this small an
  // independent draw would hand the same person out twice in a week, and the
  // person IS the puzzle here, unlike the games whose board is sixteen names.
  const chosen = pickRotating(
    pool,
    (candidate) => candidate.id,
    studiaSlug,
    puzzleNumber(gameEntry(studiaSlug).firstDay, day),
  );
  if (!chosen) return null;
  return {
    personId: chosen.id,
    personName: chosen.name,
    term: chosen.term,
    cv: chosen.cv,
  };
}

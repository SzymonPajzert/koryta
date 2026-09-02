import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import type { Edge } from "~~/shared/model";
import { branzaFromCompany } from "~~/shared/games/korytle";
import { dailyRandom, pickDaily } from "~~/shared/games/engine";
import {
  educationIndex,
  educationKey,
  type EducationTerm,
} from "~~/shared/games/education";
import { educationVocabulary } from "~~/shared/games/educationVocabulary";
import type { StudiaCvEntry } from "~~/shared/games/studia";
import { studiaMinCvEntries, studiaSlug } from "~~/shared/games/studia";

/** Who today's anonymous CV belongs to, and what they studied.
 *
 * Both routes of this game need the same answer to that question - the one
 * that serves the CV and the one that ranks a guess - and they must not be
 * able to disagree, so the pick lives here rather than in either of them.
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
function usableCv(cv: StudiaCvEntry[]): boolean {
  return cv.length >= studiaMinCvEntries;
}

export async function dailyStudiaTarget(
  day: string,
): Promise<StudiaTarget | null> {
  const index = educationIndex(educationVocabulary);

  const [people, places, regions, edges] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
    fetchEdges(),
  ]);

  /** Only people whose education resolves to a term the game can rank.
   *
   * The field is free prose by design, so this is a lookup and never a parse:
   * prose that no alias covers takes the person out of the pool rather than
   * being guessed at. Adding the alias is how such a person gets back in. */
  const candidates: { id: string; name: string; term: EducationTerm }[] = [];
  for (const person of Object.values(people)) {
    if (!person.id || !person.name || !person.visibility || person.deleted) {
      continue;
    }
    const prose = (person as { education?: string }).education;
    if (!prose?.trim()) continue;
    const term = index.get(educationKey(prose));
    if (!term) continue;
    candidates.push({ id: person.id, name: person.name, term });
  }
  if (candidates.length === 0) return null;

  const eligible = new Set(candidates.map((candidate) => candidate.id));
  const cvs = new Map<string, StudiaCvEntry[]>();
  for (const edge of edges as Edge[]) {
    if (!edge.visibility || edge.deleted) continue;
    if (!edge.source || !eligible.has(edge.source)) continue;

    if (edge.type === "employed") {
      const place = places[edge.target];
      if (!place?.visibility || place.deleted) continue;
      const entry: StudiaCvEntry = {
        kind: "praca",
        // The employer as its branża, never its name: the name is a search
        // away from the person, and the person's page prints the answer.
        what: branzaFromCompany(place.activity, place.categories),
        role: edge.name ?? "",
        from: edge.start_date?.slice(0, 4) ?? null,
        to: edge.end_date?.slice(0, 4) ?? null,
      };
      const list = cvs.get(edge.source);
      if (list) list.push(entry);
      else cvs.set(edge.source, [entry]);
    } else if (edge.type === "election") {
      const region = regions[edge.target];
      const entry: StudiaCvEntry = {
        kind: "wybory",
        what: edge.position ?? edge.name ?? "Wybory",
        role: region?.name ? `okręg: ${region.name}` : "",
        from: edge.start_date?.slice(0, 4) ?? null,
        to: null,
        party: edge.party || undefined,
      };
      const list = cvs.get(edge.source);
      if (list) list.push(entry);
      else cvs.set(edge.source, [entry]);
    }
  }

  const pool = candidates
    .map((candidate) => ({
      ...candidate,
      cv: (cvs.get(candidate.id) ?? []).sort((a, b) =>
        (a.from ?? "").localeCompare(b.from ?? ""),
      ),
    }))
    .filter((candidate) => usableCv(candidate.cv));
  if (pool.length === 0) return null;

  const [chosen] = pickDaily(
    pool,
    (candidate) => candidate.id,
    dailyRandom(studiaSlug, day),
    1,
  );
  if (!chosen) return null;
  return {
    personId: chosen.id,
    personName: chosen.name,
    term: chosen.term,
    cv: chosen.cv,
  };
}

/** What a logged out reader is shown of a person nobody has published yet.
 *
 * Nine in ten people in the base are unpublished, and until now each of them
 * was a dead end for anybody not signed in: the page answered „Dostęp
 * zastrzeżony" and nothing else, not even the name the reader had just typed
 * into the search box. The teaser is the least that makes the page worth
 * landing on - who it is and where they work now, or worked last - and the
 * reason to sign in for the rest.
 *
 * ## What it never carries
 *
 * A party, a candidacy, a committee, a note, a connection to another person. A
 * party on an unpublished person is mostly a PKW match - a name and an age
 * against the candidate lists - and nobody has checked it yet, so it can as
 * easily be a namesake's. Saying it to the public before a reviewer has would
 * put a political affiliation next to a named individual on the strength of a
 * guess. The job comes from the register the person was entered from, which
 * says it about them by name.
 *
 * The shape below is the whole of what the endpoint sends, built field by field
 * rather than spread from the document, so a field added to the person later
 * cannot reach it by accident.
 */

import { displayRole } from "./companyBodies";
import { withoutRedundantRoleless, type RoleSpell } from "./rolelessSpells";
import { spellDate } from "./succession";

/** The one post the teaser names. */
export type TeaserEmployment = {
  /** The role as the full page would print it, or absent where the register
   * named none. */
  role?: string;
  companyId: string;
  companyName: string;
  /** Whether the company's own page is live. Only then is it a link: a
   * logged out reader following one to a company nobody has published would
   * land on the same wall again. */
  companyPublished: boolean;
  start?: string;
  end?: string;
};

export type PersonTeaser = {
  /** The page the teaser is about. The survivor's id where the url named a
   * duplicate merged into it. */
  id: string;
  name: string;
  /** The post held now or held last; absent where nothing is on record. */
  employment?: TeaserEmployment;
  /** How many posts the full page lists, the one above included - the number
   * the sign-in button promises. Counted the way the page lists them, without
   * the role-less copy of a post the person also holds under its name. */
  employmentCount: number;
};

/** An `employed` edge, as much of it as the teaser reads. */
export type TeaserEdge = {
  id: string;
  source: string;
  target: string;
  name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  deleted?: boolean;
};

/** The company at the far end of a post, as much of it as the teaser reads. */
export type TeaserCompany = {
  type?: string;
  name?: string;
  published?: boolean;
  deleted?: boolean;
  supervisoryBody?: string;
};

function spellOf(edge: TeaserEdge): RoleSpell {
  return {
    personId: edge.source,
    companyId: edge.target,
    role: edge.name,
    start: edge.start_date,
    end: edge.end_date,
  };
}

/** Which of the posts is the most recent.
 *
 * One still held beats one that ended, whatever the dates: a seat taken in
 * 2015 and still held says more about somebody today than one they left last
 * month. Among those still held, the latest start wins, and one with no start
 * at all comes after every dated one - nothing says it is recent. Among the
 * ended, the latest end wins. A post whose end is still ahead counts as held.
 *
 * Ties go to the post with a role, then to the lower id, so the same edges
 * always give the same answer - the response is cached, and a teaser that
 * changed its mind between two reads would look like a bug.
 */
export function mostRecentPost<T extends TeaserEdge>(
  edges: readonly T[],
  today: number,
): T | undefined {
  const rank = (edge: T) => {
    const start = spellDate(edge.start_date);
    const end = spellDate(edge.end_date);
    const held = end === null || end >= today;
    return {
      group: held ? (start !== null ? 0 : 1) : 2,
      // Larger is more recent, within the group.
      when: held ? (start ?? 0) : end,
      start: start ?? 0,
      hasRole: edge.name ? 1 : 0,
    };
  };
  const ranked = edges.map((edge) => ({ edge, rank: rank(edge) }));
  ranked.sort(
    (a, b) =>
      a.rank.group - b.rank.group ||
      b.rank.when - a.rank.when ||
      b.rank.start - a.rank.start ||
      b.rank.hasRole - a.rank.hasRole ||
      a.edge.id.localeCompare(b.edge.id),
  );
  return ranked[0]?.edge;
}

/** The teaser for `person`, from their `employed` edges and the companies
 * those lead to (keyed by id).
 *
 * A post is left out when it was removed, or when its company is missing,
 * merged away or not a company at all - the full page would not list it
 * either, and the teaser must not name what the page does not.
 */
export function buildPersonTeaser(
  person: { id: string; name: string },
  edges: readonly TeaserEdge[],
  companies: ReadonlyMap<string, TeaserCompany>,
  today: number,
): PersonTeaser {
  const live = edges.filter((edge) => {
    if (edge.deleted === true) return false;
    const company = companies.get(edge.target);
    return (
      !!company &&
      company.type === "place" &&
      company.deleted !== true &&
      !!company.name
    );
  });
  const listed = withoutRedundantRoleless(live, spellOf);
  const latest = mostRecentPost(listed, today);
  const company = latest ? companies.get(latest.target) : undefined;
  const role = latest ? displayRole(latest.name, company) : undefined;

  return {
    id: person.id,
    name: person.name,
    ...(latest && company
      ? {
          employment: {
            ...(role ? { role } : {}),
            companyId: latest.target,
            companyName: company.name!,
            companyPublished: company.published === true,
            ...(latest.start_date ? { start: latest.start_date } : {}),
            ...(latest.end_date ? { end: latest.end_date } : {}),
          },
        }
      : {}),
    employmentCount: listed.length,
  };
}

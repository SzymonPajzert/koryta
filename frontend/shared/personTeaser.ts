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
 * Of a party it says only whether one is on record (`partyHidden`), for the
 * page to offer behind the sign in, as the same „???” chip a company's
 * board says of the same person (Szymon, 2026-10-24).
 *
 * The shape below is the whole of what the endpoint sends, built field by field
 * rather than spread from the document, so a field added to the person later
 * cannot reach it by accident.
 */

import { asArray } from "./model";
import { withoutRedundantRoleless, type RoleSpell } from "./rolelessSpells";
import { spellDate } from "./succession";

/** The company at the far end of the post, as much of it as a row of
 * „Historia powiązań” draws: its name, whether its page is live
 * (`visibility`, as the local graph answers it), and what the row's chips say
 * about it - who owns it, which sectors it is filed under, what its board is
 * called. All of it is the company's own public record. */
export type TeaserCompanyCard = {
  id: string;
  name: string;
  visibility: boolean;
  isPublic?: boolean;
  isPublicSource?: "manual";
  categories?: string[];
  supervisoryBody?: string;
};

/** The one post the teaser shows: the first row of the person's „Historia
 * powiązań”, drawn by the card the full page draws it with
 * (`CardEmploymentHistory`), which names the role and lays out the dates
 * itself. */
export type TeaserPost = {
  /** The relation's id; the row is keyed by it. */
  id: string;
  /** The role as stored, absent where the register named none. */
  name?: string;
  start_date?: string;
  end_date?: string;
  company: TeaserCompanyCard;
};

export type PersonTeaser = {
  /** The page the teaser is about. The survivor's id where the url named a
   * duplicate merged into it. */
  id: string;
  name: string;
  /** The post held now or held last; absent where nothing is on record. */
  post?: TeaserPost;
  /** How many posts the full page lists, the one above included - the number
   * the sign-in button promises. Counted the way the page lists them, without
   * the role-less copy of a post the person also holds under its name. */
  employmentCount: number;
  /** A party is on record for the person; which one is not said. */
  partyHidden?: boolean;
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
  isPublic?: boolean;
  isPublicSource?: string;
  categories?: unknown;
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
  person: { id: string; name: string; parties?: unknown },
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

  return {
    id: person.id,
    name: person.name,
    ...(latest && company
      ? {
          post: {
            id: latest.id,
            ...(latest.name ? { name: latest.name } : {}),
            ...(latest.start_date ? { start_date: latest.start_date } : {}),
            ...(latest.end_date ? { end_date: latest.end_date } : {}),
            company: companyCard(latest.target, company),
          },
        }
      : {}),
    employmentCount: listed.length,
    ...(Array.isArray(person.parties) && person.parties.length > 0
      ? { partyHidden: true }
      : {}),
  };
}

/** The company as the row draws it, field by field. */
function companyCard(id: string, company: TeaserCompany): TeaserCompanyCard {
  const categories = asArray<unknown>(
    company.categories as unknown[] | Record<string, unknown> | undefined,
  ).filter((value): value is string => typeof value === "string");
  return {
    id,
    name: company.name!,
    visibility: company.published === true,
    ...(company.isPublic === true ? { isPublic: true } : {}),
    ...(company.isPublicSource === "manual"
      ? { isPublicSource: "manual" as const }
      : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(company.supervisoryBody
      ? { supervisoryBody: company.supervisoryBody }
      : {}),
  };
}

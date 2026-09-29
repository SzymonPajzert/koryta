/** How many of the people on koryta.pl each institution has had, for the
 * companies view of /eksploruj/tabela.
 *
 * The pure half of /api/stats/companies: rows in, counts out, so the rules can
 * be tested without a Firestore. The handler does the reading.
 *
 * WHAT COUNTS. A person with a published page, holding or having held a post
 * there on an `employed` edge that is published as well - the relation a
 * company's own page lists under its board and its history. The same person
 * twice, on two terms or in two roles, is one person.
 *
 * WHAT DOES NOT. Nothing is read through ownership. `/eksploruj/tabela?place=`
 * does fold a subsidiary's people into its parent - a person's
 * `stats.edges.*.targetNodeIds` carries every company above their employer -
 * and on the 2026-09-29 export that turns ORLEN's 13 into 108 and PGE's 15
 * into 74, with „Skarb Państwa” at 301. A column of those could not be read
 * row by row: the same board member would be counted under their company, its
 * parent and the parent's parent, and a holding would outrank every company
 * that actually employs anybody. So a count here is the people of that
 * institution, the ones its page names.
 *
 * Nor is anybody unpublished, on either end. A draft person is somebody no
 * editor has checked yet, and a number that included them would say in public
 * what the site deliberately does not.
 */

import { pageIsPublic, type Edge } from "~~/shared/model";
import { calculateCurrentlyEmployed } from "~~/shared/stats";

/** An `employed` edge, as much of it as the count reads. `source` is the
 * person and `target` the institution. */
export type EmploymentEdgeRow = {
  source?: string;
  target?: string;
  start_date?: string | null;
  end_date?: string | null;
  published?: unknown;
  deleted?: unknown;
};

export type CompanyPeople = {
  /** People with a published page and a published post here, whether they
   * still hold it or not. */
  people: number;
  /** ...of whom this many still hold one: a post with no end date, or with one
   * still ahead - the rule `currentlyEmployed` is computed by everywhere else,
   * so the people view's „Teraz w publicznej spółce” agrees with it. */
  current: number;
  /** When the newest of those posts began, as an ISO day. Absent when none of
   * them carries a start date at all, which the register leaves out for some
   * older boards. */
  latestStart?: string;
};

export type CompanyPeopleStats = {
  /** When the counts were taken, so a cached answer can say how old it is. */
  generatedAt: string;
  /** By place node id. An institution nobody on the site is tied to is left
   * out rather than listed at zero: on the 2026-09-29 export that is ~3,400 of
   * ~5,100, and the page reads an absent entry as zero anyway. */
  companies: Record<string, CompanyPeople>;
};

/** The day a stored date names, or nothing for a value that is not one.
 *
 * Edges carry `YYYY-MM-DD`, and a few a full timestamp; both compare as days
 * once cut to ten characters. Anything else - a year on its own, a Firestore
 * timestamp object - is not a day the column could print, so it is dropped
 * rather than compared as a string. */
function isoDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/** People per institution, from the employment edges and the set of people
 * whose page is public.
 *
 * `publishedPeople` is passed in rather than read off the edge because an
 * edge's own flag says nothing about the node at its far end. A relation can be
 * published while the person it hangs off is still a draft - four of the 3,586
 * published employments on the 2026-09-29 export - and eight more of them hang
 * off a place rather than a person at all, which a set of people leaves out by
 * construction.
 */
export function countCompanyPeople(
  edges: EmploymentEdgeRow[],
  publishedPeople: ReadonlySet<string>,
): Record<string, CompanyPeople> {
  const tallies = new Map<
    string,
    { people: Set<string>; current: Set<string>; latestStart?: string }
  >();

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    // `deleted` included: `/api/edges/delete` keeps the document, and a removed
    // post is not somebody who worked there.
    if (!pageIsPublic(edge)) continue;
    if (!publishedPeople.has(edge.source)) continue;

    let tally = tallies.get(edge.target);
    if (!tally) {
      tally = { people: new Set(), current: new Set() };
      tallies.set(edge.target, tally);
    }
    tally.people.add(edge.source);

    // The shared rule rather than a second copy of it: an absent end date, or
    // one that has not come yet. `type` is set because the rule only looks at
    // employment, which every row here is.
    if (
      calculateCurrentlyEmployed([
        { type: "employed", end_date: edge.end_date ?? undefined } as Edge,
      ])
    ) {
      tally.current.add(edge.source);
    }

    const start = isoDay(edge.start_date);
    if (start && (!tally.latestStart || start > tally.latestStart)) {
      tally.latestStart = start;
    }
  }

  const companies: Record<string, CompanyPeople> = {};
  for (const [id, tally] of tallies) {
    companies[id] = {
      people: tally.people.size,
      current: tally.current.size,
      // Omitted rather than sent as `undefined`, which JSON drops anyway -
      // spelled out so the shape a test compares against is the wire's.
      ...(tally.latestStart ? { latestStart: tally.latestStart } : {}),
    };
  }
  return companies;
}

/** What picking an OmniSearch result means for the url.
 *
 * Kept out of the component so the rule below - which query survives a pick -
 * can be tested without a router: the component reaches for Nuxt's own router,
 * not the one a component test installs, so anything decided inside the watcher
 * is only observable through a real navigation.
 */

import type { LocationQueryRaw } from "vue-router";
import { factNameKey, type FactNameHit } from "~~/shared/factNames";
import { generateEntityUrl } from "~/composables/slugs";

export type OmniSearchPick = {
  /** Where the entry leads. Absent for an entry that only narrows the current
   * page, which then stays where it is. */
  path?: string;
  query?: Record<string, string>;
  /** A section of the page to open at, `#fakty`. */
  hash?: string;
};

type RouteLike = {
  path: string;
  query: LocationQueryRaw;
};

/** Pages a result may open. Anything else - an admin screen, a profile - is not
 * a place to show a search hit, so the pick falls back to the table. */
function isAllowedPath(path: string): boolean {
  return (
    path == "/graf" ||
    path.startsWith("/eksploruj/tabela") ||
    path.startsWith("/entity/person/") ||
    path.startsWith("/entity/region/teryt1261") ||
    path.startsWith("/region/krakow-teryt1261") ||
    path.startsWith("/osoba/") ||
    path.startsWith("/instytucja/") ||
    path.startsWith("/region/") ||
    path.startsWith("/artykul/") ||
    path.startsWith("/edit/") ||
    // An article's facts, where a name found in them is matched to no page -
    // see `factNamePick`. Signed in only, as the entry that leads there is.
    path === "/ekstrakcje"
  );
}

/** Where picking `pick` takes a visitor currently at `current`. */
export function omniSearchTarget(
  current: RouteLike,
  pick: OmniSearchPick,
): { path: string; query: LocationQueryRaw; hash?: string } {
  const path = pick.path ?? current.path;
  // The filters in the url only survive a pick that keeps us on the same page -
  // picking a party while the table is open. Carrying them across meant the
  // `revisionId` of a profile opened from the revision queue followed a search
  // to the next profile, which then rendered the previous person's proposal on
  // top of it, so the search looked like it had not navigated at all.
  const staysOnPage = !pick.path || pick.path === current.path;
  const allowed = isAllowedPath(path);

  return {
    path: allowed ? path : "/eksploruj/tabela",
    query: staysOnPage
      ? { ...current.query, ...pick.query }
      : { ...pick.query },
    // A section of the page the pick was for, not of the table it falls back to.
    ...(allowed && pick.hash ? { hash: pick.hash } : {}),
  };
}

// --- Names found only in the article facts --------------------------------

/** The query a person's page reads to show only the facts naming somebody -
 * `ExtractionPersonFacts` filters on it. */
export const FACT_NAME_QUERY = "fakty";

/** The id of „Fakty z artykułów” on a person's page. */
export const FACT_SECTION_ID = "fakty";

/** Where a name found in the facts leads.
 *
 * The page of the person whose facts name them, filtered to those facts and
 * opened at them - the other person in a relation is on show there and
 * nowhere else. Failing that, the facts of the article that names them, which
 * is all a fact matched to nobody belongs to.
 *
 * The section is named in the hash as well as scrolled to by the page itself:
 * the router takes a new page to its top once it has loaded, over any scroll
 * that came first, unless the url names somewhere else. The facts can arrive
 * either side of that moment, so each covers one side.
 */
export function factNamePick(hit: FactNameHit): OmniSearchPick {
  const person = hit.people[0];
  if (person) {
    return {
      path: generateEntityUrl("person", person.id, person.name || undefined),
      query: { [FACT_NAME_QUERY]: hit.name },
      hash: `#${FACT_SECTION_ID}`,
    };
  }
  const article = hit.articles[0];
  if (article) return { path: "/ekstrakcje", query: { article: article.url } };
  return { path: "/ekstrakcje" };
}

/** The line under a name found in the facts: where it was found, which is
 * also where picking it goes. „W faktach o: Rafał Trzaskowski”.
 *
 * The names stay in the nominative after a colon - „o Rafale Trzaskowskim”
 * would need a declension nobody has written down for a surname - and so
 * nothing after the colon is declined: where not every place is listed, the
 * count goes before it („W faktach 3 osób, m.in.: …”). */
export function factNameCaption(hit: FactNameHit): string {
  const where = hit.facts === 1 ? "W fakcie" : "W faktach";
  if (hit.people.length > 0) {
    const names = hit.people.map((p) => p.name).join(", ");
    if (hit.morePeople === 0) return `${where} o: ${names}`;
    const people = hit.people.length + hit.morePeople;
    return `${where} ${people} osób, m.in.: ${names}`;
  }
  // By site, and each site once: two articles from bankier.pl would otherwise
  // read „bankier.pl, bankier.pl”. The count says how many articles there are.
  const articles = hit.articles.length + hit.moreArticles;
  const sites = [...new Set(hit.articles.map((a) => a.domain))].join(", ");
  if (articles === 1) return `${where} z artykułu: ${sites}`;
  const listed = hit.moreArticles > 0 ? ", m.in." : "";
  return `${where} z ${articles} artykułów${listed}: ${sites}`;
}

/** The names from the facts worth listing under what the people search found.
 *
 * The server leaves out names somebody has a page under, but it reads the
 * graph for that once in twelve hours; a page added since comes back from
 * /api/search as a row of its own, and the same name again below it would be
 * two rows for one person. */
export function factNamesBesides(
  hits: FactNameHit[],
  pageNames: string[],
): FactNameHit[] {
  const pages = new Set(pageNames.map(factNameKey));
  return hits.filter((hit) => !pages.has(factNameKey(hit.name)));
}

/** What picking an OmniSearch result means for the url.
 *
 * Kept out of the component so the rule below - which query survives a pick -
 * can be tested without a router: the component reaches for Nuxt's own router,
 * not the one a component test installs, so anything decided inside the watcher
 * is only observable through a real navigation.
 */

import type { LocationQueryRaw } from "vue-router";

export type OmniSearchPick = {
  /** Where the entry leads. Absent for an entry that only narrows the current
   * page, which then stays where it is. */
  path?: string;
  query?: Record<string, string>;
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
    path.startsWith("/edit/")
  );
}

/** Where picking `pick` takes a visitor currently at `current`. */
export function omniSearchTarget(
  current: RouteLike,
  pick: OmniSearchPick,
): { path: string; query: LocationQueryRaw } {
  const path = pick.path ?? current.path;
  // The filters in the url only survive a pick that narrows the page it is on -
  // picking a party while the table is open. Carrying them across meant the
  // `revisionId` of a profile opened from the revision queue followed a search
  // to the next profile, which then rendered the previous person's proposal on
  // top of it, so the search looked like it had not navigated at all. An entry
  // that names the page open and adds nothing to it narrows nothing, and opens
  // it as from anywhere else: on a filtered table „Lista wszystkich osób” kept
  // the filters, so a reader looking at „Brak danych” went on looking at it.
  const narrowsPage =
    !pick.path || (pick.path === current.path && !!pick.query);

  return {
    path: isAllowedPath(path) ? path : "/eksploruj/tabela",
    query: narrowsPage
      ? { ...current.query, ...pick.query }
      : { ...pick.query },
  };
}

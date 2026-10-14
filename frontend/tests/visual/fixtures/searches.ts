import type { SearchesSummary } from "../../../server/api/admin/searches.get";
import { daysAgo } from "../clock";

/** /api/admin/searches for /admin/wyszukiwania's visual test.
 *
 * The searches live in the ops database, which the seed leaves empty. Rows for
 * every column the page fills: a name nobody has, one found only as an
 * unpublished person, a published one, a company, and one searched by signed
 * in readers alone - so the „Tylko niezalogowani" switch has something to
 * drop. The names are made up. */
export const searchesSummary: SearchesSummary = {
  days: 30,
  total: 23,
  signedOut: 19,
  truncated: false,
  queries: [
    {
      query: "katarzyna przykładowa",
      count: 7,
      signedOut: 7,
      noResults: 7,
      onlyUnverified: 0,
      picks: 0,
      proposes: 1,
      lastAt: daysAgo(0),
    },
    {
      query: "jan testowy",
      count: 6,
      signedOut: 5,
      noResults: 0,
      onlyUnverified: 6,
      picks: 4,
      proposes: 0,
      lastAt: daysAgo(1),
    },
    {
      query: "andrzej grzyb",
      count: 4,
      signedOut: 4,
      noResults: 0,
      onlyUnverified: 0,
      picks: 3,
      proposes: 0,
      lastAt: daysAgo(2),
    },
    {
      query: "wojewódzki zakład",
      count: 3,
      signedOut: 3,
      noResults: 0,
      onlyUnverified: 0,
      picks: 2,
      proposes: 0,
      lastAt: daysAgo(5),
    },
    {
      query: "nowa osoba",
      count: 3,
      signedOut: 0,
      noResults: 0,
      onlyUnverified: 3,
      picks: 3,
      proposes: 0,
      lastAt: daysAgo(9),
    },
  ],
};

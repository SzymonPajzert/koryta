import type { SearchesSummary } from "../../../server/api/admin/searches.get";
import type { SearchDay } from "../../../shared/searchLog";
import { daysAgo } from "../clock";

/** Fourteen days of how searches ended, today last, as [opened, found but
 * nothing opened, nothing found]. The signed out readers' are production's:
 * Plausible's search:settled for 2026-10-15..28, 209 searches. The signed in
 * ones on top are made up, a few a day and more on some, the way the owner's
 * own research comes. */
const SIGNED_OUT: [number, number, number][] = [
  [3, 2, 3],
  [13, 5, 10],
  [0, 0, 1],
  [7, 0, 5],
  [6, 5, 9],
  [1, 0, 5],
  [7, 4, 2],
  [7, 2, 13],
  [9, 4, 7],
  [6, 1, 3],
  [6, 2, 4],
  [15, 3, 13],
  [9, 6, 3],
  [3, 1, 4],
];
const SIGNED_IN: [number, number, number][] = [
  [2, 0, 1],
  [5, 1, 2],
  [0, 0, 0],
  [1, 0, 0],
  [4, 1, 3],
  [6, 2, 1],
  [3, 0, 2],
  [2, 1, 1],
  [8, 2, 4],
  [1, 0, 0],
  [0, 0, 1],
  [4, 1, 2],
  [9, 3, 6],
  [2, 0, 1],
];

const daily: SearchDay[] = SIGNED_OUT.map(([opened, notOpened, nothing], i) => {
  const [inOpened, inNotOpened, inNothing] = SIGNED_IN[i]!;
  return {
    date: daysAgo(SIGNED_OUT.length - 1 - i).slice(0, 10),
    all: {
      opened: opened + inOpened,
      notOpened: notOpened + inNotOpened,
      nothing: nothing + inNothing,
    },
    signedOut: { opened, notOpened, nothing },
  };
});

/** /api/admin/searches for /admin/wyszukiwania's visual test.
 *
 * The searches live in the ops database, which the seed leaves empty. Rows for
 * every column the page fills: a name nobody has, one found only as an
 * unpublished person, a published one, a company, and one searched by signed
 * in readers alone - so the „Tylko niezalogowani" switch has something to
 * drop. The names are made up. The day by day counts above are the window's
 * every search, which is why they add up to more than these few rows. */
export const searchesSummary: SearchesSummary = {
  days: 30,
  total: 291,
  signedOut: 209,
  truncated: false,
  daily,
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

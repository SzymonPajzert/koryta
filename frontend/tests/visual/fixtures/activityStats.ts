import type {
  ActivityContributor,
  ActivityStats,
} from "../../../server/api/stats/activity.get";
import type { ActivityCounts } from "../../../shared/activity";
import { NOW, daysAgo } from "../clock";

/** /api/stats/activity for the two pages that draw it from the browser: the
 * week's ranking on /admin, and the month's columns over /aktywnosc.
 *
 * The seed's newest revision is from 2023, so the live endpoint answers both
 * with an empty window; and its windows end today, which nothing here can
 * stop. Answered from here instead, ending on ./clock.ts's frozen day. The
 * people are made up: one has no name but an address, and one a
 * double-barrelled surname, so the name column shows what it does with both.
 * The month comes to over a thousand changes, for the four-digit figure on
 * /aktywnosc. */

const counts = (
  vote: number,
  revision: number,
  noteSource: number,
  publication: number,
): ActivityCounts => ({ vote, revision, noteSource, publication });

const total = (c: ActivityCounts) =>
  c.vote + c.revision + c.noteSource + c.publication;

const contributor = (
  uid: string,
  name: string,
  email: string | null,
  c: ActivityCounts,
  lastActiveDaysAgo: number,
): ActivityContributor => ({
  key: uid,
  uid,
  name,
  named: true,
  isSelf: false,
  email,
  photoURL: null,
  counts: c,
  total: total(c),
  lastActiveAt: daysAgo(lastActiveDaysAgo, 8),
});

/** Ranked, as the endpoint sends them. */
export const weekContributors: ActivityContributor[] = [
  contributor(
    "wizautor4",
    "Aleksandra Konstantynowicz-Szczepańska",
    "a.konstantynowicz@example.pl",
    counts(180, 12, 9, 3),
    0,
  ),
  contributor("wizautor1", "Ewa Sprawdzająca", null, counts(96, 31, 4, 0), 1),
  contributor(
    "wizautor3",
    "kontakt@stowarzyszenie-przykladowe.example.org",
    "kontakt@stowarzyszenie-przykladowe.example.org",
    counts(0, 18, 22, 0),
    2,
  ),
  contributor("wizautor2", "Marek Zgłaszający", null, counts(3, 0, 0, 27), 4),
];

/** What each of the last 30 days added up to, oldest first: a working week's
 * shape, quiet at the weekends, with one busy day - a batch of ratings. The
 * last seven come to the 405 the ranking above adds up to. */
const MONTH_TOTALS = [
  38, 44, 51, 12, 6, 47, 39, 55, 61, 42, 9, 4, 58, 63, 49, 52, 96, 14, 7, 41,
  45, 50, 38, 47, 11, 5, 186, 72, 61, 23,
];

/** Each day's total split into the four kinds, most of it ratings. */
function split(dayTotal: number): ActivityCounts {
  const revision = Math.round(dayTotal * 0.15);
  const noteSource = Math.round(dayTotal * 0.1);
  const publication = Math.round(dayTotal * 0.05);
  return counts(
    dayTotal - revision - noteSource - publication,
    revision,
    noteSource,
    publication,
  );
}

/** `days` as the page asks for it: 7 on /admin, 30 on /aktywnosc. */
export function activityStats(days: number): ActivityStats {
  const totals = MONTH_TOTALS.slice(-days);
  const daily = totals.map((dayTotal, index) => ({
    date: daysAgo(totals.length - 1 - index).slice(0, 10),
    counts: split(dayTotal),
    total: dayTotal,
  }));
  const sum = daily.reduce(
    (all, day) =>
      counts(
        all.vote + day.counts.vote,
        all.revision + day.counts.revision,
        all.noteSource + day.counts.noteSource,
        all.publication + day.counts.publication,
      ),
    counts(0, 0, 0, 0),
  );
  return {
    window: {
      since: daysAgo(days),
      until: NOW.toISOString(),
      days,
    },
    identified: true,
    totals: sum,
    total: total(sum),
    daily,
    contributorCount: days === 7 ? weekContributors.length : 27,
    contributors: weekContributors,
    namedCount: weekContributors.length,
    self: null,
    truncated: [],
  };
}

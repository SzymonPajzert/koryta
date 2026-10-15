/** The day of the election a candidacy was in, for a page to show.
 *
 * The pipeline stores a candidacy under its year alone, as „2019-01-01” - the
 * year is all of its date a payload carries, and the date is part of what the
 * ingest recognises the candidacy by (see `createElection` in
 * server/api/ingest/person.post.ts), so it stays that way. The day is looked up
 * when the edge is read (`edgeFromDB` in server/utils/fetch.ts).
 *
 * It used to be looked up by the year alone, and three years held two of the
 * elections the site records: 2014 and 2024 a local and a European one, 2019 a
 * European one and the Sejm's. Every European candidacy of those years was
 * shown on the other election's day - Paweł Kobyliński's 2019 run on 13
 * October, the Sejm's, rather than on 26 May. And 2010's day was the
 * presidential election's, which the site holds no candidacy in, so all 2010
 * local candidacies were shown five months early.
 */

/** The elections the site holds candidacies in, as far as their day goes: the
 * Sejm and the Senate are elected together, and every local office together. */
type ElectionKind = "parliament" | "european" | "local";

/** Each election's first round - the one a candidacy stands in. A mayor's
 * run-off is the same candidacy's second day, not a candidacy of its own, as
 * PKW's lists have it.
 *
 * The site holds no presidential candidacy - „Prezydent” among its offices is
 * a city's - so there are no presidential elections here. */
const ELECTION_DAYS: Record<ElectionKind, Readonly<Record<string, string>>> = {
  parliament: {
    "1989": "1989-06-04",
    "1991": "1991-10-27",
    "1993": "1993-09-19",
    "1997": "1997-09-21",
    "2001": "2001-09-23",
    "2005": "2005-09-25",
    "2007": "2007-10-21",
    "2011": "2011-10-09",
    "2015": "2015-10-25",
    "2019": "2019-10-13",
    "2023": "2023-10-15",
  },
  european: {
    "2004": "2004-06-13",
    "2009": "2009-06-07",
    "2014": "2014-05-25",
    "2019": "2019-05-26",
    "2024": "2024-06-09",
  },
  local: {
    "1990": "1990-05-27",
    "1994": "1994-06-19",
    "1998": "1998-10-11",
    "2002": "2002-10-27",
    "2006": "2006-11-12",
    "2010": "2010-11-21",
    "2014": "2014-11-16",
    "2018": "2018-10-21",
    "2024": "2024-04-07",
  },
};

/** Where to look for the day of a candidacy stored without its office: 1,549
 * of the 16,880 live ones on the 2026-10-15 export, from the uploads before
 * the ingest wrote one, and hand-made ones whose form left it empty.
 *
 * The European election comes last because, in every year it shares, it is
 * the smaller list by far: of the 42 such candidacies of 2019, 35 are in PKW's
 * Sejm or Senate lists and 3 to 5 in the European one. In a year with one
 * election, the order makes no difference. */
const UNNAMED_OFFICE_ORDER: readonly ElectionKind[] = [
  "parliament",
  "local",
  "european",
];

function electionKind(
  position: string | null | undefined,
): ElectionKind | null {
  if (!position) return null;
  if (position === "Sejm" || position === "Senat") return "parliament";
  if (position === "Parlament Europejski") return "european";
  // Every other office the site names is a local one - „Samorząd”, the
  // pipeline's word for any of them, too (`LOCAL_OFFICES` in
  // server/utils/edges.ts).
  return "local";
}

/** The day to show for a candidacy whose `start_date` is `startDate`: the day
 * of the election of its office held in that year. Only the year of
 * `startDate` is read, and a year with no such election is left as stored. */
export function candidacyDay(
  startDate: string,
  position?: string | null,
): string {
  const year = startDate.substring(0, 4);
  const kind = electionKind(position);
  for (const each of kind ? [kind] : UNNAMED_OFFICE_ORDER) {
    const day = ELECTION_DAYS[each][year];
    if (day) return day;
  }
  return startDate;
}

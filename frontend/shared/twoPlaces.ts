/** Candidacies that put one person in two places in one election.
 *
 * Nobody stands for two constituencies of the same election, so a page whose
 * candidacies do is two people. The upload sends every PKW record nothing
 * contradicts since 2026-10-07, so several namesakes' records can sit on one
 * page, unpublished, for a reviewer to reject - and the publish click is where
 * they slip through. Mariusz Michał Wiśniewski's 2014 runs in Poznań and powiat
 * grójecki went live with his page on 2026-10-07, Jacek Wojciech Kowalski's
 * 2002 runs in powiat gnieźnieński and kozienicki with his on 2026-10-14, both
 * from the publish dialog with every relation ticked.
 *
 * The rule is `test_nobody_stands_in_two_places_at_once` in
 * data/pipelines/src/tests/pipelines/test_invariants.py, the night's check that
 * holds the people upload when the count of published clashes grows. A person's
 * candidacies are grouped by the election they were stood in, whatever the
 * office: a gmina council run and a sejmik run of 2024 are one local election,
 * while 2024's european one is another contest. Two places in a group clash
 * unless one TERYT code is the other or starts with it, because a sejmik's
 * województwo contains the powiat council its candidate also ran for.
 *
 * The election is `candidacyElection`'s, worked out here rather than by each
 * reader, so the publication's hold (`clashingCandidacies` in
 * server/utils/declarationPublish.ts), the publish dialog and the person page
 * cannot group a page's runs apart. Where the night's check differs: an
 * undated run, a by-election and a run in a year with no election of its kind
 * are left out here, and a run with no office in a year of two elections goes
 * to the one `candidacyElection` reads it as, where the check gives such runs
 * a group of their own. Two undated runs are not known to be one election,
 * and a warning has to be true of the rows it names (one such edge on
 * 2026-10-15).
 */

import { candidacyElection, type ElectionKey } from "./electionDays";

/** One candidacy, as much of it as the rule reads. */
export type Candidacy = {
  /** Who stood: the edge's source. */
  personId: string;
  /** Where: the edge's target, a region node, whose id is `teryt<code>` - the
   * pipeline names them so (payloads/region.py), and all 1,389 regions in the
   * 2026-10-15 export are. */
  regionId: string;
  /** `start_date` as stored. Only the year is read: nearly every candidacy is
   * dated to the first of January of its election, a few to the day itself. */
  startDate?: string | null;
  /** The office, as stored, which says which election of the year it was. */
  position?: string | null;
  /** `by_election`: a contest of its own, which clashes with nothing. Not
   * optional, so that no reader leaves it out and files a by-election under
   * the general election of its year. */
  byElection: boolean | null | undefined;
};

/** One election in which a person's candidacies stand in places that cannot
 * all be theirs. */
export type PlaceClash<T> = {
  personId: string;
  /** As `candidacyElection` names it: „local-2024”. */
  election: ElectionKey;
  year: string;
  /** The election's rows whose place disagrees with another row's place, in
   * the order they came in. A row that agrees with every other row of the
   * election is not here - a sejmik run beside the powiat run it contains -
   * unless another row disagrees with it too. */
  rows: T[];
};

/** The TERYT code a region node's id carries, or null for any other id. */
export function regionTeryt(regionId: string): string | null {
  return /^teryt(\d+)$/.exec(regionId)?.[1] ?? null;
}

/** Whether one person can have stood in both places in one election: the same
 * place, or one inside the other. */
export function placesAgree(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

/** Every election in which `rows` put a person in two places.
 *
 * `candidacyOf` reads a row, and answers undefined for one that is not a
 * candidacy, which is then left alone - the callers hold every relation a page
 * has, in whatever shape their endpoint gave it. Which rows to hand in is the
 * caller's question: the night counts the published ones, a reviewer about to
 * publish wants the published ones and the ones they ticked.
 */
export function placeClashes<T>(
  rows: readonly T[],
  candidacyOf: (row: T) => Candidacy | undefined,
): PlaceClash<T>[] {
  const groups = new Map<
    string,
    {
      personId: string;
      election: ElectionKey;
      year: string;
      members: { row: T; teryt: string }[];
    }
  >();
  for (const row of rows) {
    const candidacy = candidacyOf(row);
    if (!candidacy) continue;
    const teryt = regionTeryt(candidacy.regionId);
    const year = candidacy.startDate?.slice(0, 4);
    const election = candidacyElection(
      candidacy.startDate,
      candidacy.position,
      candidacy.byElection,
    );
    if (!teryt || !year || !election) continue;
    const key = JSON.stringify([candidacy.personId, election]);
    let group = groups.get(key);
    if (!group) {
      group = { personId: candidacy.personId, election, year, members: [] };
      groups.set(key, group);
    }
    group.members.push({ row, teryt });
  }

  const clashes: PlaceClash<T>[] = [];
  for (const { personId, election, year, members } of groups.values()) {
    const clashing = members.filter((member) =>
      members.some((other) => !placesAgree(member.teryt, other.teryt)),
    );
    if (clashing.length === 0) continue;
    clashes.push({
      personId,
      election,
      year,
      rows: clashing.map((member) => member.row),
    });
  }
  return clashes;
}

/** The years in which the person stood in a place that agrees with `regionId`,
 * from all of `rows` - the hint for which side of a clash is theirs.
 *
 * A clash is usually one namesake's run beside a career: Kowalski stood in
 * powiat gnieźnieński in 2002, 2006, 2010, 2014 and 2018, and in powiat
 * kozienicki once. Oldest first, each year once.
 */
export function yearsInPlace<T>(
  rows: readonly T[],
  candidacyOf: (row: T) => Candidacy | undefined,
  personId: string,
  regionId: string,
): string[] {
  const teryt = regionTeryt(regionId);
  if (!teryt) return [];
  const years = new Set<string>();
  for (const row of rows) {
    const candidacy = candidacyOf(row);
    if (!candidacy || candidacy.personId !== personId) continue;
    const other = regionTeryt(candidacy.regionId);
    const year = candidacy.startDate?.slice(0, 4);
    if (other && year && placesAgree(teryt, other)) years.add(year);
  }
  return Array.from(years).sort();
}

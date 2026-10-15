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
 * candidacies are grouped by election year and office; two places in a group
 * clash unless one TERYT code is the other or starts with it, because a sejmik's
 * województwo contains the powiat council its candidate also ran for. Two kinds
 * of election in one year are two contests - 2024 held both the local and the
 * european ones - which is why the office is part of the group.
 *
 * One difference: an undated candidacy is left out here, where the check files
 * it under the year "None". Two of those are not known to be one election, and
 * a warning has to be true of the rows it names (one such edge on 2026-10-15).
 */

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
  /** The office, as stored. Absent and empty are two different groups, as
   * they are in the check: absent is a candidacy from before the field. */
  position?: string | null;
};

/** One election in which a person's candidacies stand in places that cannot
 * all be theirs. */
export type PlaceClash<T> = {
  personId: string;
  year: string;
  position: string | null;
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
  const elections = new Map<
    string,
    {
      personId: string;
      year: string;
      position: string | null;
      members: { row: T; teryt: string }[];
    }
  >();
  for (const row of rows) {
    const candidacy = candidacyOf(row);
    if (!candidacy) continue;
    const teryt = regionTeryt(candidacy.regionId);
    const year = candidacy.startDate?.slice(0, 4);
    if (!teryt || !year) continue;
    const position = candidacy.position ?? null;
    const key = JSON.stringify([candidacy.personId, year, position]);
    let election = elections.get(key);
    if (!election) {
      election = { personId: candidacy.personId, year, position, members: [] };
      elections.set(key, election);
    }
    election.members.push({ row, teryt });
  }

  const clashes: PlaceClash<T>[] = [];
  for (const { personId, year, position, members } of elections.values()) {
    const clashing = members.filter((member) =>
      members.some((other) => !placesAgree(member.teryt, other.teryt)),
    );
    if (clashing.length === 0) continue;
    clashes.push({
      personId,
      year,
      position,
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

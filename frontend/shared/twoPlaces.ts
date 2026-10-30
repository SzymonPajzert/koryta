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
 * candidacies are grouped by election year and by the kind of election they
 * were stood in (`electionStoodIn`, `election_stood_in` there); two places in a
 * group clash unless one TERYT code is the other or starts with it, because a
 * sejmik's województwo contains the powiat council its candidate also ran for.
 * Two kinds of election in one year are two contests - 2024 held both the local
 * and the european ones - which is why the kind is part of the group.
 *
 * The office is not, since 2026-10-25 in the check and 2026-10-30 here. The
 * Sejm and the Senat are filled in one election and every local office in
 * another, so a page standing for the Senat in one województwo and for the Sejm
 * in another is two people as surely as one standing for two powiat councils.
 * Keyed by the office, the dialog said nothing about Łukasz Mikołajczyk's 2015
 * Senat run in wielkopolskie beside a namesake's Sejm run in dolnośląskie, nor
 * about Kamil Klimek's 2024 Rada miasta run in Suwałki beside a namesake's Rada
 * dzielnicy run in Warszawa. All four runs were drafts on 2026-10-29, the first
 * two on a published page, the other two on a draft one.
 *
 * One difference: an undated candidacy is left out here, where the check files
 * it under the year "None". Two of those are not known to be one election, and
 * a warning has to be true of the rows it names (one such edge on 2026-10-15).
 */
import {
  electionKind,
  electionKindsIn,
  type ElectionKind,
} from "./electionDays";

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
  /** The office, as stored: what says which kind of election the candidacy
   * was stood in (`electionStoodIn`). Absent and empty both mean there is
   * none, as `field` reads them in the check. */
  position?: string | null;
};

/** One election in which a person's candidacies stand in places that cannot
 * all be theirs. */
export type PlaceClash<T> = {
  personId: string;
  year: string;
  /** Which of the year's elections (`electionStoodIn`), or null for the runs
   * with no office in a year that held two kinds, which make a group of their
   * own as they do in the check: it may be a european run beside a local one,
   * and only PKW can tell. */
  election: ElectionKind | null;
  /** The offices the rows were stood for, each once, in the order the rows
   * came in: one where they all say the same - „Samorząd”, mostly - and more
   * where a namesake ran for another office of the same election, „Sejm” and
   * „Senat”. Empty where no row names one. What a warning calls the election
   * (`clashElection`). */
  offices: string[];
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

/** Which kind of election a candidacy was stood in, or null where nothing it
 * stores says: `election_stood_in` in test_invariants.py.
 *
 * A named office says, by `electionKind`: the Sejm and the Senat are filled in
 * one parliamentary election, and every other office, „Samorząd” included, in
 * a local one. A candidacy with no office says only through its year, and only
 * in a year that held one kind of election, which is how `isSameRun` in
 * server/utils/edges.ts reads one: a 2018 candidacy without an office is that
 * year's local run, while a 2024 one could be the local or the european one,
 * and is null. */
export function electionStoodIn(
  candidacy: Pick<Candidacy, "startDate" | "position">,
): ElectionKind | null {
  if (candidacy.position) return electionKind(candidacy.position);
  const held = electionKindsIn(candidacy.startDate?.slice(0, 4) ?? "");
  return held.length === 1 ? (held[0] ?? null) : null;
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
      election: ElectionKind | null;
      members: { row: T; teryt: string; office: string | null }[];
    }
  >();
  for (const row of rows) {
    const candidacy = candidacyOf(row);
    if (!candidacy) continue;
    const teryt = regionTeryt(candidacy.regionId);
    const year = candidacy.startDate?.slice(0, 4);
    if (!teryt || !year) continue;
    const election = electionStoodIn(candidacy);
    const key = JSON.stringify([candidacy.personId, year, election]);
    let group = elections.get(key);
    if (!group) {
      group = { personId: candidacy.personId, year, election, members: [] };
      elections.set(key, group);
    }
    group.members.push({ row, teryt, office: candidacy.position || null });
  }

  const clashes: PlaceClash<T>[] = [];
  for (const { personId, year, election, members } of elections.values()) {
    const clashing = members.filter((member) =>
      members.some((other) => !placesAgree(member.teryt, other.teryt)),
    );
    if (clashing.length === 0) continue;
    const offices = new Set<string>();
    for (const { office } of clashing) if (office) offices.add(office);
    clashes.push({
      personId,
      year,
      election,
      offices: Array.from(offices),
      rows: clashing.map((member) => member.row),
    });
  }
  return clashes;
}

/** What a warning calls a clash's election: its year and the offices its rows
 * were stood for - „2002 · Samorząd”, „2015 · Senat i Sejm” - or the year
 * alone where no row names one. `separator` goes between the two. */
export function clashElection(
  clash: Pick<PlaceClash<unknown>, "year" | "offices">,
  separator = " · ",
): string {
  const { year, offices } = clash;
  if (offices.length === 0) return year;
  const names =
    offices.length === 1
      ? offices[0]
      : `${offices.slice(0, -1).join(", ")} i ${offices.at(-1)}`;
  return `${year}${separator}${names}`;
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

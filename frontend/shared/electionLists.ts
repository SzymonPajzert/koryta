import {
  candidacyDay,
  candidacyElection,
  electionName,
  electionOptions,
  type ElectionKey,
} from "./electionDays";
import { createSlug } from "./slugs";

/** One candidacy filed under a region, as `/api/nodes/[id]/election-lists`
 * answers it for this reader.
 *
 * Flat, the way the edges are stored: the region page groups them itself
 * (`groupElectionLists`), because the same answer is read twice there - once
 * whole for the region's lists, once narrowed to the person the reader came
 * from. */
export interface RegionRun {
  edgeId: string;
  personId: string;
  personName: string;
  /** The person's parties, or none where this reader is not shown them. */
  parties: string[];
  /** For a logged out reader, an unpublished person with a party on record:
   * `parties` is empty and this says there is one, as on a company's board. */
  partyHidden?: boolean;
  /** Whether the person's page is live. A name whose page is not leads to its
   * teaser instead. */
  published: boolean;
  /** As stored: the ingest's „2018-01-01”, or a day somebody typed. */
  start: string | null;
  /** The office: „Rada powiatu”, „Burmistrz”, „Sejm”. */
  position: string | null;
  committee: string | null;
  /** The party the committee stood for, as the ingest maps it („PiS” for
   * „KW PRAWO I SPRAWIEDLIWOŚĆ”), or null for a local committee. The
   * committee's, not the person's: an unpublished candidate's own party
   * stays behind the sign in, while the list they stood on is PKW's. */
  party: string | null;
  elected: boolean;
  byElection: boolean;
}

export interface RegionRuns {
  runs: RegionRun[];
  /** Runs filed here that this reader is not shown: a published person's run
   * nobody has published yet, or an unpublished person's that neither an
   * import wrote nor a reviewer approved. */
  hidden: number;
  /** Of those, the newest local election's wins, by office, that an import
   * wrote or a reviewer approved: { Prezydent: 1 } on Miasto Warszawa for a
   * logged out reader on 2026-11-11. Absent for an editor, who sees them. */
  hiddenElected?: Record<string, number>;
}

/** One person on a list, once, however many offices they stood for on it: a
 * mayor's candidate is often on the same committee's council list too. */
export interface ListMember {
  personId: string;
  personName: string;
  parties: string[];
  partyHidden?: boolean;
  published: boolean;
  /** The offices they stood for on this list, in `OFFICE_ORDER`. */
  offices: string[];
  /** Whether any of those runs won the seat. */
  elected: boolean;
}

/** The candidates one committee put up in one election, in this region. */
export interface CommitteeList {
  /** The list's id on the page: its anchor and `?lista=`. */
  key: string;
  election: ElectionKey;
  /** As the committee's runs spell it most often. */
  committee: string;
  members: ListMember[];
  /** How many runs each office took, in `OFFICE_ORDER`. */
  offices: { office: string; count: number }[];
  electedCount: number;
}

/** Every list of one election in this region. */
export interface ElectionLists {
  election: ElectionKey;
  /** „Samorządowe 2024”, as the table's election filter names it. */
  title: string;
  lists: CommitteeList[];
  /** Who stood here with no committee on record: on no list. */
  unlisted: ListMember[];
}

/** One of the runs a person stood in here, for the box at the top of the
 * region page. */
export interface PersonRun {
  /** The first of the row's runs, for a key. */
  edgeId: string;
  election: ElectionKey | null;
  /** „Samorządowe 2018”; „Wybory uzupełniające 2016” for a by-election. */
  title: string;
  /** What they stood for on this list, each with whether it won the seat:
   * a mayor's candidate is often on his committee's council list too, and
   * the two runs are one row, since they lead to one list. */
  offices: { office: string | null; elected: boolean }[];
  committee: string | null;
  /** The list it was on, or none where no committee is on record. */
  list: CommitteeList | null;
}

/** The order a list names its offices in: who runs the place, then the
 * councils from the widest down, then the bare „Samorząd” of a run nobody has
 * named the office of yet, then the national ones. */
export const OFFICE_ORDER = [
  "Prezydent",
  "Burmistrz",
  "Wójt",
  "Sejmik",
  "Rada powiatu",
  "Rada miasta",
  "Rada gminy",
  "Rada dzielnicy",
  "Samorząd",
  "Sejm",
  "Senat",
  "Parlament Europejski",
];

export function officeRank(office: string): number {
  const rank = OFFICE_ORDER.indexOf(office);
  return rank === -1 ? OFFICE_ORDER.length : rank;
}

/** PKW's abbreviations, spelled out. 2024's files write „KWW MARKA MATERKA
 * 2024” where 2018's wrote „KOMITET WYBORCZY WYBORCÓW MARKA MATERKA”, and the
 * files of one election differ too: the mayoral file and the council files
 * name the same committee each their own way. */
const ABBREVIATIONS: readonly (readonly [string, string])[] = [
  ["kkw ", "koalicyjny komitet wyborczy "],
  ["kww ", "komitet wyborczy wyborców "],
  ["kw ", "komitet wyborczy "],
];

/** What makes two spellings of a committee one committee: case, quotes, the
 * spacing around a hyphen, and the abbreviations above. Over the 2026-11-11
 * export this folds 10,426 spellings into 7,941, and every fold read as the
 * same committee: „KWW Nasz Powiat”, „KOMITET WYBORCZY WYBORCÓW „NASZ POWIAT””.
 * A quote is a break between words, not nothing: PKW also writes it with no
 * space before it („KW„Z LUDŹMI, DLA LUDZI”” in 2024).
 *
 * Deliberately no fuzzier than that. Two committees that differ by a word are
 * two lists, and putting a person on somebody else's list is the one mistake a
 * list must not make. */
export function committeeKey(committee: string): string {
  let key = committee
    .toLowerCase()
    .replace(/[„”"'«»“`]/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [short, full] of ABBREVIATIONS) {
    if (key.startsWith(short)) {
      key = full + key.slice(short.length);
      break;
    }
  }
  return key;
}

/** A list's id: the election and the committee, „local-2024--komitet-wyborczy-
 * wyborcow-marka-materka-2024”. `createSlug` never writes two dashes in a row,
 * so the double one cannot occur inside either half. */
export function listKey(election: ElectionKey, committee: string): string {
  return `${election}--${createSlug(committeeKey(committee))}`;
}

/** „Samorządowe 2024”: the name the table's election filter gives it, which
 * Szymon picked (board round election-filter-r1, 2026-10-27). */
function electionTitle(election: ElectionKey): string {
  return electionName(election) ?? election;
}

/** Newest first, as the table's filter lists them. */
const ELECTION_RANK = new Map(
  electionOptions.map((option, index) => [option.value, index]),
);

/** The surname first, as a list of candidates is read, then the rest. A
 * double surname is one word, „Kowalska-Nowak”, so the last word is right. */
export function byName(a: string, b: string): number {
  const last = (name: string) => name.trim().split(/\s+/).pop() ?? name;
  return last(a).localeCompare(last(b), "pl") || a.localeCompare(b, "pl");
}

export function membersOf(runs: readonly RegionRun[]): ListMember[] {
  const byPerson = new Map<string, ListMember>();
  for (const run of runs) {
    const member = byPerson.get(run.personId);
    if (!member) {
      byPerson.set(run.personId, {
        personId: run.personId,
        personName: run.personName,
        parties: run.parties,
        ...(run.partyHidden ? { partyHidden: true } : {}),
        published: run.published,
        offices: run.position ? [run.position] : [],
        elected: run.elected,
      });
      continue;
    }
    if (run.position && !member.offices.includes(run.position)) {
      member.offices.push(run.position);
    }
    member.elected ||= run.elected;
  }
  const members = [...byPerson.values()];
  for (const member of members) {
    member.offices.sort((a, b) => officeRank(a) - officeRank(b));
  }
  // Who won a seat first: that is what a reader scans a list for. Then the
  // surnames, as PKW's own lists would read if they were not in list order -
  // which the site does not have.
  return members.sort(
    (a, b) =>
      Number(b.elected) - Number(a.elected) ||
      byName(a.personName, b.personName),
  );
}

/** The spelling most of the list's runs use; the longer one where they tie,
 * which is the spelled-out name rather than the abbreviation. */
export function displayName(runs: readonly RegionRun[]): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const name = run.committee!.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    ([a, countA], [b, countB]) => countB - countA || b.length - a.length,
  )[0]![0];
}

function officeCounts(runs: readonly RegionRun[]) {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.position) continue;
    counts.set(run.position, (counts.get(run.position) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => officeRank(a) - officeRank(b))
    .map(([office, count]) => ({ office, count }));
}

/** A region's candidacies as its page lists them: by election, newest first,
 * then by committee, the longest list first.
 *
 * A list here is one committee in one election in this region, across every
 * office it stood for, because that is what a reader means by „the people on
 * his list”: the committee that put up a mayor also put up his councillors.
 * It is coarser than a list on a ballot paper, and the page says so. The site
 * files a gmina's council and mayoral runs under its powiat, and Sejm, Senate,
 * sejmik and European runs under the województwo, with no okręg kept, so one
 * of these can hold several of PKW's lists.
 *
 * A run stored with no election this can name (a by-election, a year with no
 * election of its kind) is on no list. */
export function groupElectionLists(
  runs: readonly RegionRun[],
): ElectionLists[] {
  const byElection = new Map<ElectionKey, RegionRun[]>();
  for (const run of runs) {
    const election = candidacyElection(run.start, run.position, run.byElection);
    if (!election) continue;
    const group = byElection.get(election);
    if (group) group.push(run);
    else byElection.set(election, [run]);
  }

  return [...byElection.entries()]
    .sort(
      ([a], [b]) =>
        (ELECTION_RANK.get(a) ?? Infinity) - (ELECTION_RANK.get(b) ?? Infinity),
    )
    .map(([election, electionRuns]) => {
      const byCommittee = new Map<string, RegionRun[]>();
      const unlisted: RegionRun[] = [];
      for (const run of electionRuns) {
        const slug = run.committee
          ? createSlug(committeeKey(run.committee))
          : "";
        if (!slug) {
          unlisted.push(run);
          continue;
        }
        const group = byCommittee.get(slug);
        if (group) group.push(run);
        else byCommittee.set(slug, [run]);
      }

      const lists = [...byCommittee.entries()].map(
        ([slug, listRuns]): CommitteeList => {
          const members = membersOf(listRuns);
          return {
            key: `${election}--${slug}`,
            election,
            committee: displayName(listRuns),
            members,
            offices: officeCounts(listRuns),
            electedCount: members.filter((member) => member.elected).length,
          };
        },
      );
      lists.sort(
        (a, b) =>
          b.members.length - a.members.length ||
          b.electedCount - a.electedCount ||
          a.committee.localeCompare(b.committee, "pl"),
      );

      return {
        election,
        title: electionTitle(election),
        lists,
        unlisted: membersOf(unlisted),
      };
    });
}

/** The runs one person stood in here, newest first, each with the list it was
 * on: one row per list, however many offices they stood for on it. */
export function personRunsIn(
  personId: string,
  runs: readonly RegionRun[],
  groups: readonly ElectionLists[],
): PersonRun[] {
  const lists = new Map(
    groups.flatMap((group) => group.lists.map((list) => [list.key, list])),
  );
  const rows = new Map<string, PersonRun>();
  // Newest first by the election's day, as the person's own page dates a run
  // (`edgeFromDB`): the stored „2024-01-01” is both April's local election
  // and June's European one, and the lists below order them by that day.
  const day = (run: RegionRun) =>
    run.start ? candidacyDay(run.start, run.position, run.byElection) : "";
  const own = runs
    .filter((run) => run.personId === personId)
    .sort((a, b) => day(b).localeCompare(day(a)));
  for (const run of own) {
    const election = candidacyElection(run.start, run.position, run.byElection);
    const list =
      election && run.committee
        ? (lists.get(listKey(election, run.committee)) ?? null)
        : null;
    const office = { office: run.position, elected: run.elected };
    // A run on no list is a row of its own.
    const row = list ? rows.get(list.key) : undefined;
    if (row) {
      row.offices.push(office);
      continue;
    }
    const year = /^(\d{4})/.exec(run.start ?? "")?.[1] ?? "";
    rows.set(list?.key ?? run.edgeId, {
      edgeId: run.edgeId,
      election,
      title: election
        ? electionTitle(election)
        : run.byElection
          ? `Wybory uzupełniające ${year}`.trim()
          : year,
      offices: [office],
      committee: run.committee,
      list,
    });
  }
  const result = [...rows.values()];
  for (const row of result) {
    row.offices.sort(
      (a, b) => officeRank(a.office ?? "") - officeRank(b.office ?? ""),
    );
  }
  return result;
}

/** What kind of place a TERYT code names, for a sentence to say „w tym
 * powiecie” rather than „w tym regionie”: two digits are a województwo, four a
 * powiat, seven a gmina. Of the four-digit codes, 61 to 99 in the last two are
 * the cities with powiat rights, which a reader calls a city. */
export type RegionKind = "wojewodztwo" | "powiat" | "miasto" | "gmina";

export function regionKind(teryt: string | undefined): RegionKind | undefined {
  if (!teryt || !/^\d+$/.test(teryt)) return undefined;
  if (teryt.length === 2) return "wojewodztwo";
  if (teryt.length === 4) {
    return Number(teryt.slice(2)) >= 61 ? "miasto" : "powiat";
  }
  if (teryt.length === 7) return "gmina";
  return undefined;
}

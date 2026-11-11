import {
  candidacyElection,
  electionOptions,
  type ElectionKey,
} from "./electionDays";
import {
  byName,
  committeeKey,
  displayName,
  membersOf,
  type ListMember,
  type RegionRun,
} from "./electionLists";
import { createSlug } from "./slugs";

/** Who governs a place, as its page draws it: the head its voters chose and
 * its councils, from the newest local election.
 *
 * Szymon, board round region-lists-r1: "Display who's currently the
 * president, who is in the rada. I know we don't have all the people right
 * now, but let's create a view that will be able to show this information."
 *
 * Read off the runs the region page already holds
 * (`/api/nodes/[id]/election-lists`), so it shows the people the site has a
 * page for, and only those this reader may see. A run says who won in April
 * 2024, not who sits today: a recall, an early election or a seat passed down
 * the list is not in it, so the view names the election it reads. */

/** The kinds of place with a government of their own. */
export type AuthorityKind =
  "wojewodztwo" | "powiat" | "miasto" | "gmina" | "dzielnica";

/** What a region node is, for the view: one of the kinds above, or
 * - `twin`: a city's „Gmina X” node (the city with powiat rights is both a
 *   powiat and a gmina, and the site has a node for each), governed by the
 *   city on its own page;
 * - `part`: the town or the rural part of a mixed gmina (TERYT digit 4 or 5,
 *   Miasto Warka), which has no government of its own;
 * - null: a delegatura (digit 9), or no TERYT code at all. */
export function authorityKind(
  teryt: string | undefined,
): AuthorityKind | "twin" | "part" | null {
  if (!teryt || !/^\d+$/.test(teryt)) return null;
  if (teryt.length === 2) return "wojewodztwo";
  const city = Number(teryt.slice(2, 4)) >= 61;
  if (teryt.length === 4) return city ? "miasto" : "powiat";
  if (teryt.length !== 7) return null;
  switch (teryt[6]) {
    case "8":
      return "dzielnica";
    case "1":
    case "2":
    case "3":
      return city ? "twin" : "gmina";
    case "4":
    case "5":
      return "part";
    default:
      return null;
  }
}

/** The newest local election, „local-2024”: the term the view reads. Off
 * the table's list of elections rather than written here, so the next term
 * needs only its day. */
export function newestLocalElection(): ElectionKey {
  return electionOptions.find((option) => option.value.startsWith("local-"))!
    .value;
}

/** One committee's members on a council, under the name most of their runs
 * give it. The committee is PKW's and public; a draft's own party is not. */
export interface CommitteeSeats {
  key: string;
  /** Null for the runs stored with no committee: „Komitet nieznany”. */
  committee: string | null;
  /** The committee's party as the ingest maps it („PiS”), or null for a
   * local list and for a coalition the map does not know. */
  party: string | null;
  members: ListMember[];
}

export interface CouncilView {
  office: string;
  /** „Sejmik województwa”, „Rada powiatu”. */
  title: string;
  /** The most members first, the unknown committee last. */
  committees: CommitteeSeats[];
  shown: number;
}

/** The head of the executive, in the state its runs leave it:
 * - held: one person recorded as winning it, and nothing hidden;
 * - contested: more than one win stored for one seat - Rzeszów and Zabrze in
 *   2026-11, a runner-up written as a win - which a reader must not be
 *   shown as the head, and an editor is shown to fix;
 * - awaiting: a win stored that this reader may not see yet (Warszawa's
 *   prezydent: his page is published, his 2024 run is not);
 * - unknown: no win stored;
 * - appointed: a starosta or a marszałek, whom the council chooses, so no
 *   election names them. */
export type ExecutiveView =
  | {
      state: "held";
      office: string;
      title: string;
      holder: ListMember;
      committee: string | null;
    }
  | { state: "contested"; office: string; title: string; holders: ListMember[] }
  | { state: "awaiting" | "unknown"; office: string; title: string }
  | { state: "appointed"; title: string };

export interface RegionAuthorities {
  kind: AuthorityKind;
  /** „Władze powiatu”. */
  title: string;
  election: ElectionKey;
  /** „2024-2029”. */
  term: string;
  executive: ExecutiveView | null;
  councils: CouncilView[];
  /** How many people the view names. Zero draws one quiet line instead. */
  shown: number;
  /** Where a place that shows nobody sends the reader: its powiat (a gmina,
   * whose runs the night files there), its city (a city's gmina twin, or a
   * Warsaw district). */
  pointer?: "powiat" | "miasto";
}

const SECTION_TITLES: Record<AuthorityKind, string> = {
  wojewodztwo: "Władze województwa",
  powiat: "Władze powiatu",
  miasto: "Władze miasta",
  gmina: "Władze gminy",
  dzielnica: "Władze dzielnicy",
};

const COUNCIL_TITLES: Record<string, string> = {
  Sejmik: "Sejmik województwa",
  "Rada powiatu": "Rada powiatu",
  "Rada miasta": "Rada miasta",
  "Rada gminy": "Rada gminy",
  "Rada dzielnicy": "Rada dzielnicy",
};

const EXECUTIVE_TITLES: Record<string, string> = {
  Prezydent: "Prezydent miasta",
  Burmistrz: "Burmistrz",
  Wójt: "Wójt",
};

/** The offices a kind's voters fill, and the head they do not elect. */
function bodiesOf(
  kind: AuthorityKind,
  teryt: string,
): { heads: string[]; appointed?: string; councils: string[] } {
  switch (kind) {
    case "wojewodztwo":
      return {
        heads: [],
        appointed: "Marszałek województwa",
        councils: ["Sejmik"],
      };
    case "powiat":
      return { heads: [], appointed: "Starosta", councils: ["Rada powiatu"] };
    case "miasto":
      return { heads: ["Prezydent"], councils: ["Rada miasta"] };
    case "gmina":
      // A town's council is a „Rada miasta”; a rural or mixed gmina's a
      // „Rada gminy”, as PKW's files name them.
      return {
        heads: ["Wójt", "Burmistrz", "Prezydent"],
        councils: teryt[6] === "1" ? ["Rada miasta"] : ["Rada gminy"],
      };
    case "dzielnica":
      return { heads: [], councils: [] };
  }
}

function committeesOf(runs: readonly RegionRun[]): CommitteeSeats[] {
  const byCommittee = new Map<string, RegionRun[]>();
  for (const run of runs) {
    const slug = run.committee ? createSlug(committeeKey(run.committee)) : "";
    const group = byCommittee.get(slug);
    if (group) group.push(run);
    else byCommittee.set(slug, [run]);
  }
  return [...byCommittee.entries()]
    .map(([slug, groupRuns]) => {
      const parties = groupRuns.flatMap((run) =>
        run.party ? [run.party] : [],
      );
      return {
        key: slug || "komitet-nieznany",
        committee: slug ? displayName(groupRuns) : null,
        party: parties[0] ?? null,
        members: membersOf(groupRuns).sort((a, b) =>
          byName(a.personName, b.personName),
        ),
      };
    })
    .sort(
      (a, b) =>
        Number(a.committee === null) - Number(b.committee === null) ||
        b.members.length - a.members.length ||
        (a.committee ?? "").localeCompare(b.committee ?? "", "pl"),
    );
}

/** The region's government from its runs. `hiddenElected` counts, by office,
 * the newest local election's wins this reader is not shown
 * (`RegionRuns.hiddenElected`). Null for a node with no government of its
 * own: a part of a gmina, a delegatura. */
export function regionAuthorities(
  runs: readonly RegionRun[],
  teryt: string | undefined,
  hiddenElected: Readonly<Record<string, number>> = {},
): RegionAuthorities | null {
  const what = authorityKind(teryt);
  if (!what || what === "part") return null;
  const election = newestLocalElection();
  const year = Number(election.slice("local-".length));
  const term = `${year}-${year + 5}`;
  if (what === "twin") {
    return {
      kind: "gmina",
      title: SECTION_TITLES.gmina,
      election,
      term,
      executive: null,
      councils: [],
      shown: 0,
      pointer: "miasto",
    };
  }
  const kind = what;
  const bodies = bodiesOf(kind, teryt!);
  const won = runs.filter(
    (run) =>
      run.elected &&
      candidacyElection(run.start, run.position, run.byElection) === election,
  );

  // The head.
  let executive: ExecutiveView | null = null;
  if (bodies.appointed) {
    executive = { state: "appointed", title: bodies.appointed };
  } else if (bodies.heads.length) {
    const headRuns = won.filter(
      (run) => run.position && bodies.heads.includes(run.position),
    );
    const holders = membersOf(headRuns);
    const hiddenOffices = bodies.heads.filter(
      (office) => (hiddenElected[office] ?? 0) > 0,
    );
    const hidden = hiddenOffices.reduce(
      (sum, office) => sum + hiddenElected[office]!,
      0,
    );
    const office =
      headRuns[0]?.position ?? hiddenOffices[0] ?? bodies.heads[0]!;
    const title = EXECUTIVE_TITLES[office] ?? office;
    if (holders.length > 1 || (holders.length === 1 && hidden > 0)) {
      executive = { state: "contested", office, title, holders };
    } else if (holders.length === 1) {
      executive = {
        state: "held",
        office,
        title,
        holder: holders[0]!,
        committee: headRuns[0]!.committee,
      };
    } else if (hidden > 0) {
      executive = { state: "awaiting", office, title };
    } else if (kind === "miasto") {
      // A city always has a prezydent; a gmina's head is drawn only where a
      // run names one, since its runs are on its powiat for now.
      executive = { state: "unknown", office, title };
    }
  }

  // The councils. The head's own seat passed down the list when they took
  // the office, so they are not among its members.
  const headId = executive?.state === "held" ? executive.holder.personId : "";
  const councils = bodies.councils.map((office): CouncilView => {
    const committees = committeesOf(
      won.filter((run) => run.position === office && run.personId !== headId),
    );
    return {
      office,
      title: COUNCIL_TITLES[office] ?? office,
      committees,
      shown: committees.reduce((sum, group) => sum + group.members.length, 0),
    };
  });

  const named =
    executive?.state === "held"
      ? 1
      : executive?.state === "contested"
        ? executive.holders.length
        : 0;
  const shown =
    named + councils.reduce((sum, council) => sum + council.shown, 0);
  return {
    kind,
    title: SECTION_TITLES[kind],
    election,
    term,
    executive,
    councils,
    shown,
    ...(shown === 0 && kind === "gmina" ? { pointer: "powiat" as const } : {}),
    ...(kind === "dzielnica" ? { pointer: "miasto" as const } : {}),
  };
}

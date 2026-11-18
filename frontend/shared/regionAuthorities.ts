import { electionOptions, type ElectionKey } from "./electionDays";
import { byName, committeeKey } from "./electionLists";
import { createSlug } from "./slugs";

/** Who governs a place, as its page draws it: the head of its executive and
 * its councils, from the record stored on the region (`Region.authorities`),
 * filled from PKW's results of the newest local election and corrected by
 * contributors since.
 *
 * Szymon, board round region-lists-r2: "Even if they are not on the page,
 * they should just be listed for the information. The region should have
 * editable parts so it's filled by PKW but if the burmistrz changes for some
 * reason, volunteers can change this information themselves". */

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

/** The newest local election, „local-2024”: the term the record is for. Off
 * the table's list of elections rather than written here, so the next term
 * needs only its day. */
export function newestLocalElection(): ElectionKey {
  return electionOptions.find((option) => option.value.startsWith("local-"))!
    .value;
}

/** „2024-2029”: the term of the councils elected in `election`. */
export function termOf(election: string = newestLocalElection()): string {
  const year = Number(/(\d{4})$/.exec(election)?.[1] ?? "");
  return Number.isFinite(year) && year > 0 ? `${year}-${year + 5}` : "";
}

/* ---------- the record as a reader is shown it ---------- */

/** A person on a region's „Władze” as `/api/nodes/[id]/authorities` hands
 * them over: the name always - PKW's, public - and their page only where this
 * reader may open it, with the parties that page shows them. */
export interface GovernmentPersonView {
  name: string;
  committee?: string;
  /** The parties the pipelines map the committee to: the colour of its
   * seats. */
  committeeParties?: string[];
  page?: {
    id: string;
    published: boolean;
    parties: string[];
    /** A party this reader is not told: an unchecked draft's. */
    partyHidden?: boolean;
  };
}

export interface GovernmentHeadView extends GovernmentPersonView {
  office: string;
  /** The party they told PKW they belong to. */
  member?: string;
  since?: string;
}

export interface GovernmentView {
  election?: string;
  head?: GovernmentHeadView;
  councils: {
    office: string;
    /** PKW's count of seats, where it is more than the names known. */
    seats?: number;
    members: GovernmentPersonView[];
  }[];
}

/* ---------- the view's sections ---------- */

const SECTION_TITLES: Record<AuthorityKind, string> = {
  wojewodztwo: "Władze województwa",
  powiat: "Władze powiatu",
  miasto: "Władze miasta",
  gmina: "Władze gminy",
  dzielnica: "Władze dzielnicy",
};

const COUNCIL_TITLES: Record<string, string> = {
  Sejmik: "Sejmik województwa",
};

const HEAD_TITLES: Record<string, string> = {
  Prezydent: "Prezydent miasta",
};

/** The head a kind of place has whom its council chooses, so no election
 * names them: the slot stays, saying „Brak danych” until somebody fills it
 * in (Szymon, 2026-11-18). */
const APPOINTED_HEADS: Partial<Record<AuthorityKind, string>> = {
  wojewodztwo: "Marszałek województwa",
  powiat: "Starosta",
  dzielnica: "Burmistrz dzielnicy",
};

/** „Prezydent miasta” for PKW's „Prezydent”; other offices as stored. */
export function headTitle(office: string): string {
  return HEAD_TITLES[office] ?? office;
}

/** One committee's seats on a council, its members by name. */
export interface CommitteeGroup {
  key: string;
  /** Null for members recorded with no committee. */
  committee: string | null;
  parties: string[];
  members: GovernmentPersonView[];
}

export interface CouncilSection {
  office: string;
  /** „Sejmik województwa”, „Rada gminy”. */
  title: string;
  seats: number;
  /** Seats whose holder is not known: `seats` less the members named. */
  unnamed: number;
  /** The most seats first, members with no committee last. */
  committees: CommitteeGroup[];
}

export interface HeadSection {
  office: string;
  /** „Burmistrz”, „Prezydent miasta”, „Starosta”. */
  title: string;
  /** Absent where nobody is known: the slot says „Brak danych”. */
  holder?: GovernmentHeadView;
  /** Chosen by the council rather than the voters: why nobody is known. */
  appointed: boolean;
}

export interface GovernmentSections {
  kind: AuthorityKind;
  /** „Władze gminy”. */
  title: string;
  /** „2024-2029”. */
  term: string;
  head?: HeadSection;
  councils: CouncilSection[];
}

function committeesOf(
  members: readonly GovernmentPersonView[],
): CommitteeGroup[] {
  const byCommittee = new Map<string, GovernmentPersonView[]>();
  for (const member of members) {
    const slug = member.committee
      ? createSlug(committeeKey(member.committee))
      : "";
    const group = byCommittee.get(slug);
    if (group) group.push(member);
    else byCommittee.set(slug, [member]);
  }
  return [...byCommittee.entries()]
    .map(([slug, group]) => ({
      key: slug || "komitet-nieznany",
      committee: slug ? group[0]!.committee! : null,
      parties:
        group.find((member) => member.committeeParties?.length)
          ?.committeeParties ?? [],
      members: [...group].sort((a, b) => byName(a.name, b.name)),
    }))
    .sort(
      (a, b) =>
        Number(a.committee === null) - Number(b.committee === null) ||
        b.members.length - a.members.length ||
        (a.committee ?? "").localeCompare(b.committee ?? "", "pl"),
    );
}

/** The sections of a place's „Władze”, off the record this reader is shown.
 * Null where there is nothing to draw: no record and no appointed head's
 * slot to hold. */
export function governmentSections(
  view: GovernmentView | null | undefined,
  kind: AuthorityKind,
): GovernmentSections | null {
  const holder = view?.head?.name ? view.head : undefined;
  const appointed = APPOINTED_HEADS[kind];
  const office = holder?.office ?? view?.head?.office ?? appointed;
  const head: HeadSection | undefined = office
    ? {
        office,
        title: headTitle(office),
        ...(holder ? { holder } : {}),
        appointed: office === appointed,
      }
    : undefined;
  const councils = (view?.councils ?? [])
    .filter((council) => council.members.length > 0)
    .map((council): CouncilSection => {
      const seats = Math.max(council.seats ?? 0, council.members.length);
      return {
        office: council.office,
        title: COUNCIL_TITLES[council.office] ?? council.office,
        seats,
        unnamed: seats - council.members.length,
        committees: committeesOf(council.members),
      };
    });
  if (!holder && !councils.length && !view) return null;
  return {
    kind,
    title: SECTION_TITLES[kind],
    term: termOf(view?.election),
    ...(head ? { head } : {}),
    councils,
  };
}

/** „PiS” for a committee the pipelines map to one party, „Trzecia Droga”
 * and „Konfederacja i BS” for the two-party lists of 2024, the committee as
 * PKW spells it for a local list: the label of its seats in the bar. */
export function committeeLabel(
  committee: string,
  parties: readonly string[],
): string {
  const set = new Set(parties);
  if (set.has("PSL") && set.has("Polska 2050")) return "Trzecia Droga";
  if (set.has("Konfederacja") && set.size > 1) return "Konfederacja i BS";
  if (parties.length === 1) {
    if (parties[0] === "PO") return "KO";
    if (parties[0] === "SLD" || parties[0] === "Nowa Lewica") return "Lewica";
    return parties[0]!;
  }
  return committee;
}

import { authorityKind } from "./regionAuthorities";

/** PKW's whole 2024 result for one place: how many seats each council has
 * and which committee won them, and who won the head's office - everybody,
 * not only the people the site has a page for.
 *
 * Read from server/assets/pkw_local_2024.json, which the pipelines write
 * from person_pkw's 2024 local rows (2,825 units, 46,558 seats, 2,476
 * heads). The numbers PKW published, so public; they are what lets a page
 * say „Rada miasta 21 mandatów” where the site knows none of the 21. */
export interface CompositionSeats {
  /** As PKW's files spell it: „KW PRAWO I SPRAWIEDLIWOŚĆ”. */
  committee: string;
  /** „PiS”, „KO”, „Trzecia Droga” for a national committee; the committee
   * itself for a local one. */
  label: string;
  /** The parties the committee stood for, as the pipelines map it:
   * ["PSL", "Polska 2050"] for Trzecia Droga, none for a local list. */
  parties: string[];
  seats: number;
}

export interface CompositionCouncil {
  office: string;
  seats: number;
  /** The most seats first; sums to `seats`. */
  split: CompositionSeats[];
}

export interface CompositionExecutive {
  office: string;
  /** PKW's title: „Burmistrz Miasta Łowicza”. */
  title: string;
  committee: string;
  label: string;
  parties: string[];
  /** The party the winner declared, or null for „nie należy do partii
   * politycznej”. */
  member: string | null;
  /** Never served unless Szymon agrees to print the names of winners who
   * have no page (round region-lists-r2). */
  name?: string;
}

export interface RegionComposition {
  election: "local-2024";
  /** The PKW unit read: „1005011”; a city's gmina twin reads its city. */
  unit: string;
  executive: CompositionExecutive | null;
  councils: CompositionCouncil[];
}

/** The PKW unit a region node's government is filed under: its own code,
 * except a city's gmina twin, which is the city, and a gmina's town or rural
 * part, which is the gmina. Null where there is none. */
export function compositionUnit(teryt: string | undefined): string | null {
  const kind = authorityKind(teryt);
  if (!kind) return null;
  if (kind === "twin") return teryt!.slice(0, 4);
  if (kind === "part") return `${teryt!.slice(0, 6)}3`;
  return teryt!;
}

/** „PiS” for a committee the pipelines map to one party, „Trzecia Droga”
 * and „Konfederacja i BS” for the two-party lists of 2024, the committee as
 * PKW spells it for a local list. */
export function committeeLabel(committee: string, parties: readonly string[]) {
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

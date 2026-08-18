import type { Article, ElectionPosition } from "./model";

/** Node data written through sanitizeFirestoreData stores arrays as objects
 * with numbered keys, so array fields have to be read tolerantly.
 *
 * Lives in `shared/` rather than beside its first caller in
 * `server/utils/nodeFilters.ts`: that module reaches the Nitro cache through
 * `server/utils/fetch.ts`, so importing three lines of array handling from it
 * pulls in `defineCachedFunction` and everything behind it.
 */
export function asArray<T>(
  value: T[] | Record<string, T> | undefined | null,
): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}


/** The parties a person can be filtered by, and the only strings that get a
 * chip. Anything else is stored and then invisible: no colour, no dropdown
 * entry, and bucketed as "inne / brak partii" in the statistics.
 *
 * Kept in step with `committee_to_party` in
 * `data/scrapers/src/scrapers/pkw/elections.py`, which is where the pipeline
 * decides what to call a party. SLD is separate from Nowa Lewica on purpose:
 * they are the same party renamed in 2021, but somebody who stood on an SLD
 * list in 2001 was not a member of a party that did not exist yet, and the
 * election it comes from is the whole of the evidence. */
export const parties = [
  "PO",
  "PiS",
  "PSL",
  "Polska 2050",
  "Nowa Lewica",
  "SLD",
  "Konfederacja",
  "Razem",
];

export const partyColors: Record<string, string> = {
  PO: "#fca241",
  PiS: "#073b76",
  PSL: "#2ed396",
  "Polska 2050": "#FFCB03",
  "Nowa Lewica": "#D40E20",
  SLD: "#D40E20",
  Konfederacja: "#102440",
  // Razem: "#871057",
};

export const electionPositions: ElectionPosition[] = [
  "Samorząd", // TODO remove it
  "Sejmik",
  "Rada miasta",
  "Rada gminy",
  "Rada powiatu",
  "Burmistrz",
  "Wójt",
  "Prezydent",
  "Sejm",
  "Senat",
  "Parlament Europejski",
];

export const electionTerms = ["2024-2029", "2018-2024", "2014-2018"];

const breakpoint = /\.|-/;

// uses a list of defined markers to split the title
function splitTitle(title: string, limit?: number): string[] {
  return title.split(breakpoint, limit);
}

export function getSubtitle(data: Article): string | undefined {
  const parts = splitTitle(data.name, 2);
  if (parts.length < 2 || !parts[1]) return undefined;
  return parts.length > 1 ? parts[1].trim() : undefined;
}

export function getShortTitle(data: Article): string {
  const split = splitTitle(data.name, 1);
  if (!split[0]) return "";
  return split[0].trim();
}

export function getHostname(data: Article): string {
  try {
    if (!data.sourceURL) return "";
    return new URL(data.sourceURL).hostname;
  } catch {
    console.error("failed to parse URL", data.sourceURL);
    return data.sourceURL;
  }
}

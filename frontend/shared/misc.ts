import type { Article } from "./model";

export const parties = [
  "PO",
  "PiS",
  "PSL",
  "Polska 2050",
  "Nowa Lewica",
  "Konfederacja",
  "Razem",
];

export const partyColors: Record<string, string> = {
  PO: "#fca241",
  PiS: "#073b76",
  PSL: "#2ed396",
  "Polska 2050": "#FFCB03",
  "Nowa Lewica": "#D40E20",
  Konfederacja: "#102440",
  Razem: "#871057",
};

export const electionPositions = [
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
export function splitTitle(title: string, limit?: number): string[] {
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

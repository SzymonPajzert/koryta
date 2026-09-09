import type { Article, ElectionPosition } from "./model";

/** The parties a person can be filtered by, and the only strings that get a
 * chip. Anything else is stored and then invisible: no colour, no dropdown
 * entry, and bucketed as "inne / brak partii" in the statistics.
 *
 * Kept in step with `committee_to_party` in
 * `data/pipelines/src/scrapers/pkw/elections.py`, which is where the pipeline
 * decides what to call a party. SLD is separate from Nowa Lewica on purpose:
 * they are the same party renamed in 2021, but somebody who stood on an SLD
 * list in 2001 was not a member of a party that did not exist yet, and the
 * election it comes from is the whole of the evidence.
 *
 * The last two run ahead of that map, because the names reach a person by
 * another road: the article pipeline already canonicalises "nowoczesna", and
 * „Bezpartyjni Samorządowcy" arrives from a person's own edit - the one PKW
 * committee carrying the name, the joint „Konfederacja i Bezpartyjni
 * Samorządowcy" list, is still read as Konfederacja alone. Until they were
 * listed here neither could be picked in „Przynależność partyjna" at all.
 * Nowoczesna stays separate from PO on the same reasoning as SLD: somebody who
 * stood on a .Nowoczesna list in 2015 stood for a party that was its own then.
 *
 * Order is the graph legend's rank - `graph/Container.vue` sorts by
 * `parties.indexOf` - so a name goes on the end rather than in its historical
 * place. */
export const parties = [
  "PO",
  "PiS",
  "PSL",
  "Polska 2050",
  "Nowa Lewica",
  "SLD",
  "Konfederacja",
  "Razem",
  "Nowoczesna",
  "Bezpartyjni Samorządowcy",
];

/** Party names that stand for the same thing, folded to one key.
 *
 * SLD and Nowa Lewica are the same lineage - the party renamed in 2021 - and
 * the site already paints them the same #D40E20, which made them two bars a
 * reader could not tell apart and could not add up either. They are counted
 * together now.
 *
 * Folding at the counting stage matters for more than tidiness: a person whose
 * node carries BOTH labels was counted twice on one seat, once under each name.
 * Callers must apply `canonicalParty` to a set, not a list, so the same seat is
 * not counted twice under the merged key. */
export const partyAliases: Record<string, string> = {
  SLD: "Nowa Lewica",
};

/** What to call a merged key, where the merged name would hide what went in. */
export const partyMergedLabels: Record<string, string> = {
  "Nowa Lewica": "Nowa Lewica / SLD",
};

/** The name a party is counted under. Unknown parties pass through unchanged. */
export function canonicalParty(party: string): string {
  return partyAliases[party] ?? party;
}

/** Every stored name that a canonical key stands for, itself included - what a
 * link has to filter on so the merged bar and the table behind it agree. */
export function partyAliasesOf(canonical: string): string[] {
  return [
    canonical,
    ...Object.entries(partyAliases)
      .filter(([, to]) => to === canonical)
      .map(([from]) => from),
  ];
}

/** What a chip, a bar and a graph dot are filled with. A party listed above
 * without a fill here is drawn flat and never named in the graph legend, which
 * only admits a party it has a colour for.
 *
 * `PartyChip` labels these with `readableInkOn`, which picks between black and
 * white and nothing in between, so a fill has to clear AA against one of those
 * two poles - tests/components/PartyChip.test.ts measures every entry here so
 * that a new colour cannot arrive unreadable.
 *
 * Keep the keys in the order `parties` uses: `chart/TreemapParty.vue` walks
 * `parties` and `Object.values` of this map by the same index, so a fill added
 * out of order would put one party's name on another's colour. That is why the
 * two names below sit after Razem's commented-out line rather than in front of
 * it. */
export const partyColors: Record<string, string> = {
  PO: "#fca241",
  PiS: "#073b76",
  PSL: "#2ed396",
  "Polska 2050": "#FFCB03",
  "Nowa Lewica": "#D40E20",
  SLD: "#D40E20",
  Konfederacja: "#102440",
  // Razem: "#871057",
  // Nowoczesna's own turquoise, a step darker than the brand cyan: PSL's mint
  // is the only other colour on this side of the wheel, and at graph-dot size
  // the two have to stay tellable apart. Black on it: 6.90:1.
  Nowoczesna: "#00A9B7",
  // A committee people describe themselves by rather than a party with a
  // palette to be faithful to, so the violet is chosen for separation: every
  // other fill here is orange, yellow, red, green or navy, and it stays clear
  // of Razem's wine above should that line ever be uncommented. White on it:
  // 7.64:1.
  "Bezpartyjni Samorządowcy": "#6A3D9A",
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

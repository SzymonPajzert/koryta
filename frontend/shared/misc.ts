import type { Article, ElectionPosition } from "./model";
import { asArray } from "./model";
import { readableInkOn } from "./colors";

/** „Inne”: a political tie we found that is not to one of the parties named
 * below - a small party, a local one, a list outside the national ones. Stored
 * on a person like any other party and filtered on like one, so the table can
 * answer "who is political at all", but drawn greyed out wherever a party is
 * drawn: it says that there is a tie, not whose, and must not read as one more
 * party beside PiS and PO. */
export const OTHER_PARTY = "Inne";

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
 * Razem, Nowoczesna and „Bezpartyjni Samorządowcy" each come from their own
 * lists too: Razem's 2015 Sejm and 2018 sejmik ones, Nowoczesna's 2015 Sejm one,
 * and BS's from 2014 on. The joint „Konfederacja i Bezpartyjni Samorządowcy"
 * list of 2024 counts as both parties. Nowoczesna stays separate from PO on the
 * same reasoning as SLD: somebody who stood on a .Nowoczesna list in 2015 stood
 * for a party that was its own then.
 *
 * Order is the graph legend's rank - `graph/Container.vue` sorts by
 * `parties.indexOf` - so a name goes on the end rather than in its historical
 * place. `OTHER_PARTY` stays last of all, behind any party added later: it is
 * the remainder, and the legend and every dropdown list it after the parties
 * it is the remainder of. */
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
  OTHER_PARTY,
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
 * `partyChipPaint` labels these with `readableInkOn`, which picks between
 * black and white and nothing in between, so a fill has to clear AA against one
 * of those two poles - tests/components/PartyChip.test.ts measures every entry
 * here so that a new colour cannot arrive unreadable.
 *
 * The keys are kept in the order `parties` uses. Nothing now pairs the two by
 * index - `chart/TreemapParty.vue` did, and went with the home page's party
 * panel - so a fill out of order no longer puts one party's name on another's
 * colour. It stays a lookup keyed by name, and the order stays tidy: that is
 * why the two names below sit after Razem's commented-out line rather than in
 * front of it.
 *
 * `OTHER_PARTY` is the one entry whose chip is not its fill - see
 * `partyChipPaint`. */
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
  // The chart palette's axis grey (`ink.axis` in app/utils/chartTheme.ts), the
  // colour /eksploruj/szpitale already gave a party the site has no colour
  // for - which is what this is. Lighter than the #898781 that stands for
  // „bez partii” there and for „pozostałe” on the timeline, 2.00:1 apart, so
  // the two greys stay tellable apart in one bar. As a graph dot it is about
  // as faint as Polska 2050's yellow: greyed out, and still there.
  [OTHER_PARTY]: "#c3c2b7",
};

/** „Inne” as a chip: a pale grey pill in grey ink, so that it reads as greyed
 * out rather than as one more party. On #c3c2b7 the chart palette's secondary
 * ink, #52514e, measures 4.43:1 - under AA - and a grey pill in black ink is
 * just a grey party, so the chip takes the chart palette's gridline grey
 * instead, where that ink measures 6.00:1. The dot and the bar keep #c3c2b7,
 * which a fill this pale would leave invisible on a white canvas. */
const OTHER_PARTY_CHIP = { backgroundColor: "#e1e0d9", color: "#52514e" };

/** How a party chip is painted: its own fill in whichever of black and white
 * reads on it, `OTHER_PARTY` greyed out, and nothing for a party with no
 * colour - the caller decides what that looks like on its own surface.
 *
 * One function for every chip, so a party reads the same in the table's rows,
 * the filter that picks it and the chip in the query bar. */
export function partyChipPaint(
  party: string,
): { backgroundColor: string; color: string } | undefined {
  if (party === OTHER_PARTY) return { ...OTHER_PARTY_CHIP };
  const fill = partyColors[party];
  return fill
    ? { backgroundColor: fill, color: readableInkOn(fill) }
    : undefined;
}

/** The party whose colour a person is drawn in - on the graph, where the dot's
 * colour is all a reader has to go on.
 *
 * The first party with a colour of its own, passing over `OTHER_PARTY`: a
 * person's parties are stored in the order somebody picked them, or sorted by
 * name where `ingest/person` merged them - either way „Inne” can come ahead of
 * PiS - and a named party says more than the remainder does.
 * Failing that `OTHER_PARTY` - also for a party with no colour of its own,
 * Razem among them, because from the reader's side that is exactly what it
 * is: a tie to a party the site does not paint. Undefined only for somebody
 * with no party at all, who is then the plain person blue and nothing else. */
export function paintedParty(
  held: string[] | Record<string, string> | undefined | null,
  colors: Record<string, string> = partyColors,
): string | undefined {
  // Blank entries are a form's leftovers, not a tie to anybody.
  const all = asArray(held).filter(
    (party) => typeof party === "string" && party.trim() !== "",
  );
  if (all.length === 0) return undefined;
  return (
    all.find((party) => party !== OTHER_PARTY && colors[party]) ?? OTHER_PARTY
  );
}

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

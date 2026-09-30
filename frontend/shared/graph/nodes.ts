import type { Node } from "./model";
import type { Person, Company, Region } from "../model";
import { paintedParty } from "../misc";

/** What each kind of node is painted, where a party colour does not decide it.
 *
 * Named here because the graph's legend has to say the same thing the canvas
 * does, and because the values used to be the css keywords `gray` and `green` -
 * a flat mid grey that read as "disabled" next to the party colours, and a
 * primary green loud enough to pull the eye to whichever region happened to be
 * on screen. */
export const NODE_COLORS = {
  /** Somebody with no party at all. The party ones come from `shared/misc`,
   * „Inne” and a party with no colour of its own among them.
   *
   * Grey, the #898781 the charts already give „bez partii” (`ink.muted` in
   * app/utils/chartTheme.ts), and 2.00:1 from „Inne”'s paler grey. It was a
   * blue, which a reader took for PiS's or Konfederacja's navy (#fb-wg0Zsc). */
  person: "#898781",
  place: "#6b7a83",
  region: "#3f7d58",
} as const;

/** The canvas's own inks, as against what a node or an edge means: the same on
 * every graph, whatever is drawn on it. */
export const GRAPH_INK = {
  /** A name under a node, and the dark glyph on a light node. */
  label: "#1b1b1b",
  /** The plate behind a name, so that it reads over the edges it crosses. */
  labelPlate: "rgba(255, 255, 255, 0.86)",
  /** The page's white: the hairline round a node, and the light glyph on a
   * dark one. */
  paper: "#ffffff",
  /** Every edge but the pointed-at node's, while one is pointed at. */
  dimmedEdge: "#dde2e5",
  /** An edge's caption. */
  edgeLabel: "#000000",
} as const;

export function personNode(
  person: Person,
  partyColors: Record<string, string>,
): Node {
  // Falls back on the plain person grey rather than on nothing. A party with
  // no colour here - one the pipeline knows and `shared/misc` does not, Razem
  // among them - used to leave `color` undefined, and an svg shape with no
  // fill is drawn black: a node that read as a party of its own, and a legend
  // that could not name it. `paintedParty` now draws such a party as „Inne”,
  // so the grey is left meaning no party at all.
  const party = paintedParty(person.parties, partyColors);
  const color = ((party ? partyColors[party] : undefined) ??
    NODE_COLORS.person) as Node["color"];
  return {
    ...person,
    entityType: person.type,
    type: "circle",
    color: color,
    visibility: person.visibility,
  };
}

export function companyNode(company: Company): Node {
  return {
    ...company,
    entityType: company.type,
    type: "rect",
    color: NODE_COLORS.place,
    visibility: company.visibility,
  };
}

export function regionNode(region: Region): Node {
  return {
    ...region,
    entityType: region.type,
    type: "document",
    color: NODE_COLORS.region,
    visibility: region.visibility,
  };
}

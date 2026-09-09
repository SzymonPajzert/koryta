import type { Edge } from "./model";

/** How each kind of relation is drawn.
 *
 * Employment is the site's subject, so it is the one solid line; everything
 * else is dashed, at a weight that says how much of a claim it is. Colour
 * alone would not do it - a reader who cannot separate the sage from the mauve
 * can still count the gaps in a dash.
 *
 * Here rather than inside the canvas, the way `NODE_COLORS` sits in
 * `shared/graph/nodes.ts`: the legend has to draw the same line the canvas
 * does, and a second table would be a second answer to "what is a dotted
 * line". */
export type EdgeStyle = { color: string; width: number; dasharray?: string };

/** What a relation nobody drew a line for looks like: the ones that hang off an
 * article rather than off a register entry. */
export const ASIDE: EdgeStyle = {
  color: "#9aa5ab",
  width: 1.4,
  dasharray: "2 4",
};

// Keyed by the edge type rather than by `string`, so adding one to
// `shared/graph/model.ts` fails the typecheck here the way it already does at
// `edgeLabel` in shared/graph/util.ts, instead of quietly drawing it as "zna".
export const EDGE_STYLE: Record<Edge["type"], EdgeStyle> = {
  employed: { color: "#59707c", width: 2.2 },
  connection: { color: "#8d6a9f", width: 2, dasharray: "7 4" },
  owns: { color: "#6f8f5a", width: 1.8, dasharray: "3 3" },
  // A seat is geography, not a claim about anybody, so it is drawn as faintly
  // as the article-side relations - the same green as ownership, because they
  // were one type until the register's shareholder lists arrived and a reader
  // who remembers the old graph should still recognise the line.
  seat: { color: "#6f8f5a", width: 1.2, dasharray: "2 5" },
  election: { color: "#b98235", width: 1.8, dasharray: "1 4" },
  mentions: ASIDE,
  comment: ASIDE,
  tagged: ASIDE,
};

/** Falls back to the acquaintance style. The table above is exhaustive over the
 * declared union, but the type is read straight off a firestore document, and a
 * row written before a rename is not bound by it. */
export function edgeStyle(edge: Edge): EdgeStyle {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return EDGE_STYLE[edge.type] ?? EDGE_STYLE.connection;
}

/** What the legend calls each line, in the order it lists them: the solid one
 * first, because that is the one every other line is read against.
 *
 * A noun and not the verb `edgeLabel` prints along a line ("pracuje"), because
 * this names a kind of line rather than what one particular relation says. Not
 * `edgeTypeLabels` from `app/composables/edges.ts` either: those are the
 * fragments a row in a list is built from ("Zatrudniony/a w"), and they name
 * the three article-side relations separately where the legend draws them as
 * one line. Keyed by the type like the style table above, so a new relation
 * has to be named for the reader before it typechecks. */
const EDGE_LEGEND_LABEL: Record<Edge["type"], string> = {
  employed: "Zatrudnienie",
  owns: "Właściciel",
  seat: "Siedziba",
  election: "Kandydatura",
  connection: "Znajomość",
  // The three that hang off an article rather than a register entry share one
  // grey dash, so they share one name: the reader is being told how much of a
  // claim the line is, and it is the same amount for all three.
  mentions: "Wzmianka w artykule lub notatce",
  comment: "Wzmianka w artykule lub notatce",
  tagged: "Wzmianka w artykule lub notatce",
};

export interface EdgeLegendKey extends EdgeStyle {
  key: string;
  label: string;
}

/** The line styles standing on the canvas right now, named.
 *
 * Only the kinds in front of the reader, the same discipline the party colours
 * follow: naming all six on a graph that draws two would make the legend
 * longer than the thing it explains. Grouped by how the line is actually
 * drawn, because two identical swatches on separate lines would read as a
 * distinction the canvas is not making - the article-side relations are one
 * entry, not three. */
export function edgeLegend(edges: Edge[]): EdgeLegendKey[] {
  const present = new Set<string>(
    // An unknown type is drawn as an acquaintance, so that is the kind the
    // legend has to account for it under.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    edges.map((edge) => (EDGE_STYLE[edge.type] ? edge.type : "connection")),
  );

  const byStyle = new Map<string, EdgeLegendKey>();
  for (const [type, label] of Object.entries(EDGE_LEGEND_LABEL) as [
    Edge["type"],
    string,
  ][]) {
    if (!present.has(type)) continue;
    const style = EDGE_STYLE[type];
    const key = `${style.color}|${style.width}|${style.dasharray ?? "solid"}`;
    if (!byStyle.has(key)) byStyle.set(key, { key, label, ...style });
  }
  return [...byStyle.values()];
}

import type { Node as GraphNode } from "~~/shared/graph/model";
import type { NodeType } from "~~/shared/model";
import { GRAPH_INK } from "~~/shared/graph/nodes";

/** Which page a node on the canvas leads to.
 *
 * `entityType` is the node's own kind, carried straight off the database record
 * by `shared/graph/nodes.ts`. The shape below it is the fallback for a payload
 * written before that field existed - and it is a guess, because `document` is
 * drawn for a region and for an article alike.
 */
export function graphNodeDestination(
  node: GraphNode | undefined,
): NodeType | undefined {
  if (!node) return undefined;
  if (node.entityType) return node.entityType as NodeType;
  switch (node.type) {
    case "circle":
      return "person";
    case "rect":
      return "place";
    case "document":
      return "teryt" in node ? "region" : "article";
    default:
      return undefined;
  }
}

/** White or near-black, whichever the given fill can carry.
 *
 * A node's colour is its party's, and those run from a near-black navy to a
 * bright yellow, so one fixed choice of ink leaves the glyph invisible on half
 * of them. Anything that is not a hex - the `gray` and `green` keywords older
 * node builders used - is treated as dark, which both of those are.
 */
export function readableInk(color: string | undefined): string {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color ?? "");
  if (!match) return GRAPH_INK.paper;
  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? GRAPH_INK.label : GRAPH_INK.paper;
}

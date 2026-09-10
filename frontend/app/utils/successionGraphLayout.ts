import {
  forceCollide,
  forceLink,
  forceSimulation,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { ChainDirection, ChainNode } from "~/composables/successionChain";
import { gapLabel } from "~~/shared/succession";

/** Where every circle and every arrow of the succession graph goes.
 *
 * A picture of what a reader has ALREADY opened, and nothing else: the input is
 * the same `ChainNode[]` the columns are drawn from, so the graph can never
 * show a person the columns do not, can never fall behind an expansion, and
 * never sends a request of its own. It holds no state either - it is a function
 * of the array, called again whenever the array changes.
 *
 * Kept out of the component so it can be tested on coordinates rather than on
 * markup. `tests/shared/graph/simulationLayout.test.ts` is the precedent, and
 * the reason for it: the entity graph's other test mocks d3 out, so it could
 * say which forces were configured and nothing about where anybody ended up -
 * which is how two people came to be drawn on top of each other. The only
 * assertion worth making about a layout is the settled distance between two
 * nodes, and that needs the real forces and a pure function to run them in.
 */

/** One person, at the place this layout puts them. */
export type GraphLayoutNode = {
  /** The chain's own key - the path from the focus person, never the person's
   * id. Two branches can legitimately reach the same human and must stay two
   * circles; keying anything here by `personId` would merge them, and give the
   * simulation one node with two parents. */
  key: string;
  personId: string;
  /** Verbatim from the chain, so it is empty in two different states: while
   * the request is in flight, and for good where the reader may not be told
   * who this is. `status` and `unnamable` are what tell those apart, and a
   * caller that draws one glyph for both is spending it on two facts. */
  name: string;
  x: number;
  y: number;
  /** The signed chain column: 0 at the focus person, negative on the
   * predecessor side, positive on the successor side, and equal in size to the
   * node's depth. Exposed rather than kept private because it is the thing the
   * columns underneath are also cut on - a test that wants to know the picture
   * agrees with them asserts on this. */
  column: number;
  focus: boolean;
  status: ChainNode["status"];
  /** Settled, and still nameless: the endpoint answered and this reader may
   * not be told who it is. Not an error - nothing failed - and the columns
   * draw it as an em dash rather than as one. */
  unnamable: boolean;
};

/** One "was replaced by" arrow. */
export type GraphLayoutEdge = {
  key: string;
  /** The node whose person held the seat FIRST. */
  fromKey: string;
  /** The node whose person held it next. Always the other end of the same
   * parent/child hop; which end is which comes from the child's own
   * `direction` and never from where the two ended up on screen, because a
   * branch that doubles back puts the successor to the LEFT of the
   * predecessor. */
  toKey: string;
  /** The successor's start minus the predecessor's end, from the closest
   * filing the candidacy rests on. Null where the parent's candidate list has
   * nothing to join this hop to, which the UI cannot produce - a child is only
   * ever opened from a card on a ready parent - but a hand-built fixture can.
   * The arrow is still drawn then, just bare. */
  gapDays: number | null;
  /** Polish, for the arrow's `<title>`: the company, the seat and how far
   * apart the two filings are, through `gapLabel` so this page and the
   * person's own page say the same thing about the same two rows. */
  label: string | null;
  /** True where the register recorded a batch rather than a handover - several
   * seats in one body changing on one day - so it does not say who replaced
   * whom. The columns say that in a sentence per list; an arrow's honest
   * equivalent is a visibly weaker one, and drawing it the same as a
   * one-to-one hop would be the picture claiming more than the register does.
   *
   * True if ANY seat the candidacy rests on was a batch, not just the one
   * `label` cites. The arrow is a single claim about two people, and it should
   * be the weaker of the reasons behind it. */
  batched: boolean;
};

export type SuccessionGraphLayout = {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  /** The viewBox, in the same units as every coordinate above. */
  width: number;
  height: number;
  /** Handed back rather than restated in the component: the vertical spacing
   * below is chosen against these two, so a component that picked its own
   * radius would draw circles the collision force never accounted for. */
  nodeRadius: number;
  /** How far below a node's centre its one line of label sits. */
  labelOffset: number;
};

export type SuccessionGraphLayoutOptions = {
  /** The key of the person the page is about. The chain hands it out as a
   * constant so no layout has to know that it is `"root"`; left out, the node
   * with no parent is taken to be the focus, which is the same node. */
  focusKey?: string;
  nodeRadius?: number;
  /** The floor under how close two circles in one column may sit. Bigger than
   * two radii on purpose: each node carries a line of text under it. */
  rowGap?: number;
  columnGap?: number;
  /** How many times the simulation is stepped. The default takes alpha from 1
   * to `alphaMin` at d3's own decay rate, i.e. it settles. */
  ticks?: number;
};

const NODE_RADIUS = 9;

/** 42px holds a 9px circle, a 11px label under it and clear air between that
 * label and the next circle down. It is also the collision diameter, so it is
 * the number a column of thirty is as tall as: thirty of Ryszard Grobelny's
 * kind of board is 1,260px of graph, which the component scrolls in its own
 * box rather than growing the page with. */
const ROW_GAP = 42;

/** Wide enough for a name at 11px between two columns without the two touching.
 * The columns underneath are 260-320px, and the graph is deliberately tighter:
 * it is an overview of a chain whose detail is already on screen below it. */
const COLUMN_GAP = 150;

/** How many times the simulation is stepped before the answer is read off.
 *
 * d3's default alpha decay reaches `alphaMin` at 300 ticks, so every force that
 * scales with alpha - the two pulls below - has stopped doing anything by then.
 * The rest is `forceCollide`, which ignores alpha and is the only hard
 * constraint here, relaxing what the pulls left overlapping. It needs the room:
 * measured on a thirty-person column, the closest pair is still 25.7px apart at
 * 300 ticks, 41.5 at 600 and exactly the 42 asked for at 800.
 *
 * The whole layout costs 2ms for a two-node chain, 32ms for a thirty-one node
 * one and 150ms at a hundred - once per expansion, not once per frame, because
 * nothing here animates. */
const TICKS = 800;

/** How hard a node is held to its own slot in its column.
 *
 * Weak, because the slot is a fallback and not the answer: what makes the
 * picture readable is children sitting level with their parents, which is the
 * link force's job. This one only decides where the degrees of freedom the
 * links leave open end up - without it a branch with no siblings would drift
 * off with nothing to stop it, and two runs would settle differently for
 * reasons no test could name.
 */
const SLOT_STRENGTH = 0.12;

/** How hard a parent and a child are pulled to the same height.
 *
 * A hop is a horizontal arrow when the two are level and a diagonal when they
 * are not, and a fan of six diagonals is much harder to follow than a fan of
 * six that are nearly flat. Set below 1 so a crowded column loses to
 * `forceCollide`, which is the only hard constraint here: a chain where the
 * links win is a chain with two circles in the same place.
 */
const KIN_STRENGTH = 0.5;

/** Which side of the focus person a branch hangs on, per node key.
 *
 * The fold is `ChainColumns.vue`'s, deliberately down to the shape of the
 * ternary: the graph sits directly above those columns and a node that landed
 * in a different column here than there would be the page telling a reader two
 * different things about one person. The side is a branch's FIRST hop - a node
 * reached by opening a predecessor's successors is still part of the branch
 * that went left - which is also why the arrow direction below cannot be read
 * off the x order.
 *
 * One pass, because `nodes` is ordered parents before children.
 */
function columnIndexes(nodes: ChainNode[]): Map<string, number> {
  const sides = new Map<string, ChainDirection | "focus">();
  const indexes = new Map<string, number>();

  for (const node of nodes) {
    const parentSide = node.parentKey ? sides.get(node.parentKey) : undefined;
    const side: ChainDirection | "focus" =
      node.direction === null
        ? "focus"
        : parentSide && parentSide !== "focus"
          ? parentSide
          : node.direction;
    sides.set(node.key, side);
    indexes.set(
      node.key,
      side === "focus" ? 0 : side === "predecessor" ? -node.depth : node.depth,
    );
  }

  return indexes;
}

/** What the register says about one hop, read off the parent's own candidate
 * list rather than fetched again.
 *
 * Matched on `expandedKey`, which the composable builds with the same function
 * the child's key came from, so exactly one candidate can match. Matching on
 * the person instead would be wrong as well as weaker: one human can appear on
 * both sides of one node - they left the seat just before this person took it
 * and came back just after - and the endpoint keys them apart by side for that
 * reason.
 */
function hopFacts(
  parent: ChainNode,
  child: ChainNode,
): Pick<GraphLayoutEdge, "gapDays" | "label" | "batched"> {
  const list =
    child.direction === "predecessor" ? parent.predecessors : parent.successors;
  const candidate = list.find(
    (view) => view.expandedKey === child.key,
  )?.candidate;
  const closest = candidate?.via[0];
  if (!candidate || !closest) {
    return { gapDays: null, label: null, batched: false };
  }
  return {
    gapDays: closest.gapDays,
    label: `${closest.companyName} · ${closest.role} · ${gapLabel(closest.gapDays)}`,
    batched: candidate.via.some((entry) => entry.batchSize > 1),
  };
}

/** What d3 is handed: a key to join links on, the slot the node would sit in
 * if nothing else pulled on it, and a pinned x. */
type Datum = SimulationNodeDatum & { key: string; slotY: number };

/** Where the chain's open nodes go when they are drawn as a graph.
 *
 * Deterministic, and that is a requirement rather than a happy accident. x is
 * pinned per node - the column IS the x - so only y is solved, and d3 seeds and
 * jiggles from its own LCG (`d3-force/src/lcg.js`) rather than from
 * `Math.random`, with a fresh generator per simulation. So the same array
 * settles on the same coordinates every time, and a test can assert them. It
 * does mean the result depends on the ORDER of `nodes`: pass the composable's
 * own array, parents before children, which is also the order the columns
 * stack.
 *
 * Ticked synchronously to equilibrium and thrown away. Nothing is stored, no
 * animation runs and no frame is ever requested: `forceSimulation()` starts a
 * `d3-timer` the moment it is constructed, which is why `.stop()` comes before
 * `.tick()` here exactly as it does in `shared/graph/simulation.ts`. A
 * simulation left running would run on the server too - the component module is
 * in the server bundle even though `<ClientOnly>` keeps it from rendering.
 */
export function layoutSuccessionGraph(
  nodes: ChainNode[],
  options: SuccessionGraphLayoutOptions = {},
): SuccessionGraphLayout {
  const nodeRadius = options.nodeRadius ?? NODE_RADIUS;
  const rowGap = options.rowGap ?? ROW_GAP;
  const columnGap = options.columnGap ?? COLUMN_GAP;
  const ticks = options.ticks ?? TICKS;

  const labelOffset = nodeRadius + 13;
  const topPad = nodeRadius + 6;
  /** The label hangs below the circle, so the bottom of the box is a line of
   * text past the lowest centre and not a radius. */
  const bottomPad = labelOffset + 6;

  if (nodes.length === 0) {
    // An empty box of the ordinary size rather than a degenerate one: an
    // element whose width or height is zero has its rendering disabled
    // outright, which is a harder thing for a caller to notice than a blank
    // frame. Nothing here ever draws it anyway - the component says so in
    // Polish instead.
    return {
      nodes: [],
      edges: [],
      width: columnGap,
      height: topPad + bottomPad,
      nodeRadius,
      labelOffset,
    };
  }

  const indexes = columnIndexes(nodes);

  // Indexed into the SORTED DISTINCT list rather than multiplied out, so a
  // chain that only ever went left is as narrow as the columns under it are.
  // Empty slots on the right would be the graph reserving room for successors
  // nobody has opened.
  const order = [...new Set(indexes.values())].sort((a, b) => a - b);

  // Two passes over the column: a node's slot needs to be centred against how
  // many others share the column, and that is only known once they have all
  // been counted. Centring each column on zero rather than stacking them from
  // the top is what keeps the focus person level with the middle of a
  // six-person board instead of level with its first name.
  const slots = new Map<string, number>();
  const sizes = new Map<number, number>();
  for (const node of nodes) {
    const index = indexes.get(node.key)!;
    const size = sizes.get(index) ?? 0;
    slots.set(node.key, size);
    sizes.set(index, size + 1);
  }

  const data: Datum[] = nodes.map((node) => {
    const index = indexes.get(node.key)!;
    const slotY = (slots.get(node.key)! - (sizes.get(index)! - 1) / 2) * rowGap;
    // Half a gap in from the left edge, so the leftmost node's label has the
    // same room under it as everybody else's - the box is `order.length`
    // columns wide, not `order.length - 1` gaps.
    const x = (order.indexOf(index) + 0.5) * columnGap;
    return { key: node.key, slotY, x, fx: x, y: slotY };
  });

  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const links: SimulationLinkDatum<Datum>[] = [];
  const edges: GraphLayoutEdge[] = [];
  for (const node of nodes) {
    if (node.parentKey === null) continue;
    const parent = byKey.get(node.parentKey);
    // Unreachable through the composable - `collapse` drops a node together
    // with every key that starts with its own - but a layout that threw on a
    // hand-built array would be a layout nobody could write a fixture for.
    if (!parent) continue;

    links.push({ source: parent.key, target: node.key });

    // The arrow points the way the seat moved, which is the child's own hop: a
    // successor took it AFTER the parent, a predecessor held it BEFORE them.
    // Never the column order - a branch that goes back and then forward draws
    // an arrow pointing left, and that is correct.
    const [fromKey, toKey] =
      node.direction === "successor"
        ? [parent.key, node.key]
        : [node.key, parent.key];

    edges.push({
      key: `${parent.key}->${node.key}`,
      fromKey,
      toKey,
      ...hopFacts(parent, node),
    });
  }

  forceSimulation(data)
    .force(
      "kin",
      forceLink<Datum, SimulationLinkDatum<Datum>>(links)
        .id((datum) => datum.key)
        // Zero, not the column gap: x is pinned, so the only part of this
        // force that survives the tick is the y component, and a target
        // distance of one column would ask for a slack that the horizontal
        // separation already provides. What is left is "sit level with your
        // parent".
        .distance(0)
        .strength(KIN_STRENGTH),
    )
    .force(
      "slot",
      forceY<Datum>((datum) => datum.slotY).strength(SLOT_STRENGTH),
    )
    // The hard floor, and the only force here that is not a preference. A
    // radius of half the row gap is what makes two circles in one column end
    // up a whole row apart - and a column can hold thirty: the measured
    // fan-out is a median of two candidates per person, seven at the ninetieth
    // percentile and thirty at the worst person in the register. Nodes in
    // different columns are further apart than this in x alone, so this never
    // fights the column assignment.
    .force(
      "collide",
      // Three passes rather than one. A single pass resolves each pair against
      // the quadtree as it finds them, which in a column of thirty leaves a
      // fan-out squashed for hundreds of ticks while the pull is still on;
      // three converge on the row gap while there is still alpha left to do it
      // with.
      forceCollide<Datum>(rowGap / 2)
        .strength(1)
        .iterations(3),
    )
    .stop()
    .tick(ticks);

  // Rounded, because the last few ticks move a node by a ten-thousandth of a
  // pixel and neither an SVG nor a reader can tell: this keeps the emitted
  // coordinates readable in a failing test and stable in a diff.
  const round = (value: number) => Math.round(value * 100) / 100;

  const settled = new Map(data.map((datum) => [datum.key, datum]));
  const ys = data.map((datum) => datum.y ?? 0);
  const top = Math.min(...ys);

  // The simulation works around zero; the viewBox starts at it. One shift, so
  // the whole picture keeps the shape it settled into.
  const shift = topPad - top;

  return {
    nodes: nodes.map((node) => ({
      key: node.key,
      personId: node.personId,
      name: node.personName,
      x: round(settled.get(node.key)!.x ?? 0),
      y: round((settled.get(node.key)!.y ?? 0) + shift),
      column: indexes.get(node.key)!,
      focus: options.focusKey
        ? node.key === options.focusKey
        : node.parentKey === null,
      status: node.status,
      // Only once the answer has landed. A node still in flight has no name
      // either, and calling that one unnamable would turn "we have not asked
      // yet" into "you may not be told".
      unnamable: node.status === "ready" && node.personName === "",
    })),
    edges,
    width: order.length * columnGap,
    height: round(Math.max(...ys) - top + topPad + bottomPad),
    nodeRadius,
    labelOffset,
  };
}

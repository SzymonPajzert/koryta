import { Graph, layout } from "@dagrejs/dagre";

/** How big a task's card is on the map. The layout is computed for this
 * size, so the card's CSS must match it. */
export const TASK_NODE_WIDTH = 248;
export const TASK_NODE_HEIGHT = 96;
const GAP = 24;
const RANK_GAP = 72;
/** Between two separate chains: wider than inside one, so each reads as a
 * whole. */
const CHAIN_GAP = 72;
/** The shape the packed chains aim for, width over height - about a screen. */
const ASPECT = 1.6;

export type TaskPlacement = {
  /** Top-left corners, as Vue Flow places nodes. */
  positions: Map<string, { x: number; y: number }>;
  /** Tasks joined to nothing on the map, in the grid under the flow. */
  isolated: string[];
  /** Where the grid starts, for its label; null when there is no grid. */
  gridTop: number | null;
};

type Block = {
  members: string[];
  /** Relative to the block's own top-left corner. */
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
};

/** One chain laid out on its own, left to right. */
function layoutChain(
  members: readonly string[],
  edges: readonly (readonly [string, string])[],
): Block {
  const graph = new Graph();
  graph.setGraph({
    rankdir: "LR",
    nodesep: GAP,
    ranksep: RANK_GAP,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  // Added in the order given, so the same list lays out the same way on
  // every load.
  for (const id of members) {
    graph.setNode(id, { width: TASK_NODE_WIDTH, height: TASK_NODE_HEIGHT });
  }
  for (const [prerequisite, dependent] of edges) {
    graph.setEdge(prerequisite, dependent);
  }
  layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  let width = 0;
  let height = 0;
  for (const id of members) {
    const { x, y } = graph.node(id);
    // dagre gives centres.
    const left = x - TASK_NODE_WIDTH / 2;
    const top = y - TASK_NODE_HEIGHT / 2;
    positions.set(id, { x: left, y: top });
    width = Math.max(width, left + TASK_NODE_WIDTH);
    height = Math.max(height, top + TASK_NODE_HEIGHT);
  }
  return { members: [...members], positions, width, height };
}

/** Where each task goes on the map. Tasks joined by dependencies are laid out
 * as flows from left to right - what has to happen first on the left, so the
 * first column of each is what can be started - and the rest sit in a grid
 * under them, ready to be joined to something.
 *
 * Each separate chain is laid out on its own and the chains are packed in
 * rows, biggest first. Laid out as one graph, forty short chains would stack
 * into a column forty chains tall, too narrow to read at any zoom that shows
 * it whole.
 *
 * `edges` are `[prerequisite, dependent]` pairs; any naming a task that is not
 * in `ids` is ignored. */
export function placeTasks(
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
): TaskPlacement {
  const shown = new Set(ids);
  const drawn = edges.filter(
    ([a, b]) => a !== b && shown.has(a) && shown.has(b),
  );
  const joined = new Set(drawn.flat());

  // Which chain each task is in: union-find over the arrows.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    parent.set(id, root);
    return root;
  };
  for (const id of joined) parent.set(id, id);
  for (const [a, b] of drawn) parent.set(find(a), find(b));
  const chains = new Map<string, string[]>();
  for (const id of ids) {
    if (!joined.has(id)) continue;
    const root = find(id);
    if (!chains.has(root)) chains.set(root, []);
    chains.get(root)!.push(id);
  }

  const blocks = [...chains.values()]
    .map((members) => {
      const inChain = new Set(members);
      return layoutChain(
        members,
        drawn.filter(([a]) => inChain.has(a)),
      );
    })
    // Biggest first; `sort` is stable, so equal ones keep the list's order.
    .sort((a, b) => b.members.length - a.members.length);

  const positions = new Map<string, { x: number; y: number }>();
  const area = blocks.reduce(
    (sum, b) => sum + (b.width + CHAIN_GAP) * (b.height + CHAIN_GAP),
    0,
  );
  const rowWidth = Math.max(
    ...blocks.map((b) => b.width),
    Math.sqrt(area * ASPECT),
  );
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let flowWidth = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > rowWidth) {
      x = 0;
      y += rowHeight + CHAIN_GAP;
      rowHeight = 0;
    }
    for (const [id, at] of block.positions) {
      positions.set(id, { x: x + at.x, y: y + at.y });
    }
    flowWidth = Math.max(flowWidth, x + block.width);
    rowHeight = Math.max(rowHeight, block.height);
    x += block.width + CHAIN_GAP;
  }
  const flowBottom = blocks.length > 0 ? y + rowHeight : 0;

  const isolated = ids.filter((id) => !joined.has(id));
  const step = TASK_NODE_WIDTH + GAP;
  // As wide as the flow above it, within reason, so the two read as one map.
  const columns = Math.min(
    10,
    Math.max(3, Math.round((flowWidth + GAP) / step) || 4),
  );
  const gridTop =
    isolated.length === 0 ? null : blocks.length > 0 ? flowBottom + 3 * GAP : 0;
  isolated.forEach((id, index) => {
    positions.set(id, {
      x: (index % columns) * step,
      y:
        (gridTop ?? 0) + Math.floor(index / columns) * (TASK_NODE_HEIGHT + GAP),
    });
  });
  return { positions, isolated, gridTop };
}

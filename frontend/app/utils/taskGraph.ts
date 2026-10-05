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
 * under them, ready to be joined to something. A folded card (`stacked`) is a
 * chain of its own even with no arrow left to it, not a loose task.
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
  stacked: ReadonlySet<string> = new Set(),
): TaskPlacement {
  const shown = new Set(ids);
  const drawn = edges.filter(
    ([a, b]) => a !== b && shown.has(a) && shown.has(b),
  );
  const joined = new Set([
    ...drawn.flat(),
    ...ids.filter((id) => stacked.has(id)),
  ]);

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

type Edges = readonly (readonly [string, string])[];

/** Who waits on whom among `ids`, both ways round. */
function neighbours(ids: readonly string[], edges: Edges) {
  const shown = new Set(ids);
  const prerequisites = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const [prerequisite, dependent] of edges) {
    if (prerequisite === dependent) continue;
    if (!shown.has(prerequisite) || !shown.has(dependent)) continue;
    if (!prerequisites.has(dependent)) prerequisites.set(dependent, []);
    prerequisites.get(dependent)!.push(prerequisite);
    if (!dependents.has(prerequisite)) dependents.set(prerequisite, []);
    dependents.get(prerequisite)!.push(dependent);
  }
  return { prerequisites, dependents };
}

/** The tasks that fold into `id`: those that lead to it, through any number
 * of others, and to nothing else. A task that also leads somewhere outside
 * stays out, and so does everything that leads to it - folding them away
 * would hide an arrow that goes somewhere else. */
function foldGroup(
  id: string,
  prerequisites: ReadonlyMap<string, readonly string[]>,
  dependents: ReadonlyMap<string, readonly string[]>,
): string[] {
  const group = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    const member = queue.pop()!;
    // A task is looked at again each time one of those it leads to joins, so
    // it is taken in once the last of them has.
    for (const candidate of prerequisites.get(member) ?? []) {
      if (group.has(candidate)) continue;
      if ((dependents.get(candidate) ?? []).every((d) => group.has(d))) {
        group.add(candidate);
        queue.push(candidate);
      }
    }
  }
  group.delete(id);
  return [...group];
}

/** How many tasks folding each of `ids` would hide - zero for one that
 * nothing leads to alone. */
export function foldSizes(
  ids: readonly string[],
  edges: Edges,
): Map<string, number> {
  const { prerequisites, dependents } = neighbours(ids, edges);
  return new Map(
    ids.map((id) => [id, foldGroup(id, prerequisites, dependents).length]),
  );
}

/** The ends of the chains: tasks nothing on the map waits on. */
export function terminalTasks(ids: readonly string[], edges: Edges): string[] {
  const { dependents } = neighbours(ids, edges);
  return ids.filter((id) => !dependents.has(id));
}

export type TaskFolds = {
  /** Every folded task and what it folds, drawn or folded into another. */
  groups: Map<string, string[]>;
  /** Each task folded away, and the card it is drawn as instead. */
  hiddenIn: Map<string, string>;
  /** Each folded card still drawn, and how many tasks it stands for. */
  stacks: Map<string, number>;
  /** What is still drawn. */
  ids: string[];
  /** The arrows between what is drawn. One into a task folded away goes to
   * the card it is folded into, and `pairs` says which dependencies an arrow
   * stands for - several, when they have been folded into one. */
  edges: { source: string; target: string; pairs: [string, string][] }[];
};

/** The map with `folded` folded: each of them drawn as one card standing for
 * itself and everything that leads only to it.
 *
 * Two folds never overlap in part: whatever leads only to a task that leads
 * only to another leads only to that other too. So a fold is either inside
 * another - and then hidden in it - or apart from it. */
export function foldTasks(
  ids: readonly string[],
  edges: Edges,
  folded: ReadonlySet<string>,
): TaskFolds {
  const { prerequisites, dependents } = neighbours(ids, edges);
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    if (!folded.has(id)) continue;
    const group = foldGroup(id, prerequisites, dependents);
    if (group.length > 0) groups.set(id, group);
  }
  // The biggest first: a fold inside another is then already hidden when its
  // turn comes, and so is everything in it.
  const hiddenIn = new Map<string, string>();
  const stacks = new Map<string, number>();
  for (const [id, group] of [...groups].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    if (hiddenIn.has(id)) continue;
    stacks.set(id, group.length);
    for (const member of group) hiddenIn.set(member, id);
  }
  const drawnAs = (id: string) => hiddenIn.get(id) ?? id;
  const merged = new Map<string, TaskFolds["edges"][number]>();
  for (const [prerequisite, dependent] of edges) {
    if (!prerequisites.get(dependent)?.includes(prerequisite)) continue;
    const source = drawnAs(prerequisite);
    const target = drawnAs(dependent);
    if (source === target) continue;
    const key = `${source}->${target}`;
    if (!merged.has(key)) merged.set(key, { source, target, pairs: [] });
    merged.get(key)!.pairs.push([prerequisite, dependent]);
  }
  return {
    groups,
    hiddenIn,
    stacks,
    ids: ids.filter((id) => !hiddenIn.has(id)),
    edges: [...merged.values()],
  };
}

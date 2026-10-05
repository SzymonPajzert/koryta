<template>
  <div class="task-map" data-task-map>
    <VueFlow
      :id="FLOW_ID"
      :nodes="nodes"
      :edges="edges"
      :nodes-draggable="false"
      :nodes-connectable="true"
      :elements-selectable="true"
      :connect-on-click="true"
      :delete-key-code="null"
      :min-zoom="0.05"
      :max-zoom="1.5"
      :default-edge-options="{ type: 'default' }"
      @connect="onConnect"
      @node-click="({ node }) => node.type === 'task' && pick(node.id)"
      @edge-click="
        ({ edge }) => !edge.data?.intoFold && (selectedEdge = edge.id)
      "
      @pane-click="selectedEdge = null"
    >
      <template #node-task="{ data }">
        <TasksMapNode
          :task="data.task"
          :state="data.state"
          :section="data.section"
          :progress="data.progress"
          :selected="data.task.id === selected"
          :faded="data.faded"
          :foldable="data.foldable"
          :stacked="data.stacked"
          :focusable="data.focusable"
          :focused="data.task.id === focused"
          :valid-connection="isValidConnection"
          @fold="fold(data.task.id)"
          @unfold="unfold(data.task.id)"
          @focus="emit('focus', data.task.id)"
          @unfocus="unfocus"
        />
      </template>
      <template #node-label="{ data }">
        <div class="task-map__label">{{ data.text }}</div>
      </template>
    </VueFlow>

    <TasksMapBar
      :marks="marks"
      :dragging="!!dragFrom"
      :drop="drop"
      :focused="focused ? byId.get(focused)?.title : null"
      :can-fold-all="unfoldedEnds.length > 0"
      :can-unfold-all="folds.stacks.size > 0"
      @pick="pickMark"
      @unfocus="unfocus"
      @fold-all="foldAll"
      @unfold-all="unfoldAll"
    />

    <div class="task-map__tools">
      <v-btn
        icon
        size="small"
        variant="flat"
        title="Pokaż wszystko"
        aria-label="Pokaż wszystko"
        @click="fit(200)"
      >
        <v-icon :icon="mdiFitToPageOutline" />
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="flat"
        title="Przybliż"
        aria-label="Przybliż"
        @click="zoomIn()"
      >
        <v-icon :icon="mdiPlus" />
      </v-btn>
      <v-btn
        icon
        size="small"
        variant="flat"
        title="Oddal"
        aria-label="Oddal"
        @click="zoomOut()"
      >
        <v-icon :icon="mdiMinus" />
      </v-btn>
    </div>

    <!-- An arrow is taken away the way it was picked out: on the map, with
         the two tasks it joins named, since a line alone is easy to mistake
         for its neighbour. -->
    <div v-if="edgeShown" class="task-map__edge-bar" data-task-edge-bar>
      <span class="text-body-2">
        <strong>{{ edgeShown.dependent.title }}</strong>
        czeka na
        <strong>{{ edgeShown.prerequisite.title }}</strong>
      </span>
      <v-btn
        size="small"
        variant="flat"
        color="ink-danger"
        :prepend-icon="mdiLinkVariantOff"
        data-task-disconnect
        @click="disconnect"
      >
        Usuń zależność
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        icon
        aria-label="Zamknij"
        @click="selectedEdge = null"
      >
        <v-icon :icon="mdiClose" />
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  MarkerType,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
} from "@vue-flow/core";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import {
  mdiClose,
  mdiFitToPageOutline,
  mdiLinkVariantOff,
  mdiMinus,
  mdiPlus,
} from "@mdi/js";
import {
  TASK_NODE_HEIGHT,
  TASK_NODE_WIDTH,
  foldSizes,
  foldTasks,
  placeTasks,
  terminalTasks,
} from "~/utils/taskGraph";
import {
  dependencyProblem,
  goalProgress,
  isClosed,
  taskSection,
  type Task,
  type TaskState,
} from "~~/shared/tasks";
import type { TaskMark } from "./MapBar.vue";

/** The task list as a flowchart: an arrow from each task to what waits on it,
 * laid out left to right so the first column is what can be started.
 *
 * The layout is computed, never dragged: every arrow drawn or taken away lays
 * the map out again, and a hand-placed card would be moved anyway. What the
 * map is for is joining tasks - drag from the right edge of the task that has
 * to happen first to the left edge of the one that waits (or tap one edge,
 * then the other) - and seeing the chains that come out of it.
 *
 * A task can be folded: drawn as a stack of cards that stands for it and for
 * everything that leads only to it. Arrows still reach it, and new ones can be
 * drawn to it; which tasks are folded is kept in the browser.
 *
 * And the map can be focused on a task, to show only it and what it waits on.
 * The page keeps that in the url and hands over only those tasks; the map
 * asks for it and draws the way back. */

const FLOW_ID = "tasks-map";

type Point = { x: number; y: number };

const props = defineProps<{
  /** The tasks on the map. */
  tasks: readonly Task[];
  /** Every task, for judging a new arrow against the whole list. */
  all: readonly Task[];
  states: Map<string, TaskState>;
  /** Shown only for context - joined to a task the filter kept, or on a
   * focused map, which a filter only fades. */
  faded?: ReadonlySet<string>;
  selected?: string | null;
  /** The task the map is focused on: `tasks` are it and what it waits on. */
  focused?: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  /** Show only this task and what it waits on; null for the whole map. */
  focus: [id: string | null];
  connect: [prerequisite: string, dependent: string];
  disconnect: [prerequisite: string, dependent: string];
}>();

const {
  fitBounds,
  zoomIn,
  zoomOut,
  setCenter,
  setViewport,
  viewport,
  onPaneReady,
  onConnectStart,
  onConnectEnd,
  connectionClickStartHandle,
  endConnection,
  autoPanOnConnect,
} = useVueFlow(FLOW_ID);

/** The task last clicked on the map itself: it is in view already, so
 * picking it must not move the map from under the pointer. */
let clicked: string | null = null;
const pick = (id: string) => {
  clicked = id;
  emit("select", id);
};

const shownIds = computed(() => props.tasks.map((task) => task.id));

const pairs = computed(() => {
  const shown = new Set(shownIds.value);
  return props.tasks.flatMap((task) =>
    task.dependsOn
      .filter((dep) => shown.has(dep))
      .map((dep) => [dep, task.id] as const),
  );
});

// ---- folding ----

const FOLDED_KEY = "koryta:zadania:zwiniete";

function readFolded(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? "[]");
    return new Set(
      Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    // Nothing kept, a broken entry or no storage at all: nothing folded.
    return new Set();
  }
}

/** The tasks folded, as asked for - whether or not anything leads to them
 * alone right now, which a filter or a closed task can change. */
const folded = ref<Set<string>>(import.meta.client ? readFolded() : new Set());

function setFolded(next: Set<string>) {
  folded.value = next;
  // Only tasks that still exist, so that the list does not grow for ever.
  const known = new Set(props.all.map((task) => task.id));
  try {
    localStorage.setItem(
      FOLDED_KEY,
      JSON.stringify([...next].filter((id) => known.has(id))),
    );
  } catch {
    // Storage refused (a private window, say): the folds last as long as
    // the page does.
  }
}

// The card the map is focused on is never folded, and has no button for it:
// everything else on the map leads to it alone, so its stack would stand for
// all of it. Folded before, it is folded again once the focus is left.
const folds = computed(() => {
  const asked = new Set(folded.value);
  if (props.focused) asked.delete(props.focused);
  return foldTasks(shownIds.value, pairs.value, asked);
});
/** How many tasks folding each card would hide; its button shows for any. */
const sizes = computed(() => {
  const sizes = foldSizes(shownIds.value, pairs.value);
  if (props.focused) sizes.delete(props.focused);
  return sizes;
});
/** The tasks that wait on another one on the map, whether the arrow is drawn
 * or folded into their stack: focusing on one shows more than its card. */
const waiting = computed(
  () => new Set(pairs.value.map(([, dependent]) => dependent)),
);
/** The ends of the chains that „Zwiń wszystkie” would still fold. */
const unfoldedEnds = computed(() =>
  terminalTasks(shownIds.value, pairs.value).filter(
    (id) => (sizes.value.get(id) ?? 0) > 0 && !folds.value.stacks.has(id),
  ),
);

const placement = computed(() =>
  placeTasks(
    folds.value.ids,
    folds.value.edges.map((edge) => [edge.source, edge.target] as const),
    new Set(folds.value.stacks.keys()),
  ),
);

/** Moves the view with a card the layout moved from `before` to `after`, so
 * that on the screen it stays where it was. */
function holdStill(before: Point, after: Point) {
  const { x, y, zoom } = viewport.value;
  void setViewport({
    x: x + (before.x - after.x) * zoom,
    y: y + (before.y - after.y) * zoom,
    zoom,
  });
}

/** Folding or unfolding a card lays the map out again; the card itself is
 * kept where it was on the screen, so it stays under the pointer. */
async function keepInPlace(id: string, change: () => void) {
  const before = placement.value.positions.get(id);
  change();
  await nextTick();
  const after = placement.value.positions.get(id);
  if (before && after) holdStill(before, after);
}

/** The card whose focus was left from the map, and where it was: the rest of
 * the map comes back around it rather than all of it being fitted in, as
 * after a fold. The page hands over the tasks only once the url has changed,
 * so this waits for them in the watcher below. */
let leaving: { id: string; at: Point } | null = null;

function unfocus() {
  const id = props.focused;
  if (!id) return;
  const at = placement.value.positions.get(id);
  leaving = at ? { id, at } : null;
  emit("focus", null);
}

const fold = (id: string) =>
  keepInPlace(id, () => setFolded(new Set([...folded.value, id])));

const unfold = (id: string) =>
  keepInPlace(id, () => {
    const next = new Set(folded.value);
    next.delete(id);
    setFolded(next);
  });

async function foldAll() {
  setFolded(new Set([...folded.value, ...unfoldedEnds.value]));
  await nextTick();
  fit(200);
}

async function unfoldAll() {
  setFolded(new Set());
  await nextTick();
  fit(200);
}

/** Unfolds whatever hides `id`, so that a task picked from a link or from
 * beside the map can be shown. Folds inside it stay folded. */
function reveal(id: string) {
  if (!folds.value.hiddenIn.has(id)) return false;
  const next = new Set(folded.value);
  for (const [foldedId, group] of folds.value.groups) {
    if (group.includes(id)) next.delete(foldedId);
  }
  setFolded(next);
  return true;
}

const nodes = computed<Node[]>(() => {
  const { positions, gridTop } = placement.value;
  const drawn = props.tasks.filter((task) => positions.has(task.id));
  const cards: Node[] = drawn.map((task) => {
    const state = props.states.get(task.id)!;
    return {
      id: task.id,
      type: "task",
      position: positions.get(task.id)!,
      width: TASK_NODE_WIDTH,
      height: TASK_NODE_HEIGHT,
      data: {
        task,
        state,
        section: taskSection(task, state),
        // Over the whole list, closed tasks included: they are the progress.
        progress:
          task.kind === "goal" ? goalProgress(props.all, task.id) : null,
        faded: props.faded?.has(task.id) ?? false,
        foldable: sizes.value.get(task.id) ?? 0,
        stacked: folds.value.stacks.get(task.id) ?? 0,
        focusable: waiting.value.has(task.id),
      },
    };
  });
  // Named only when chains or stacks sit above the loose tasks.
  if (gridTop !== null && gridTop > 0) {
    cards.push({
      id: "__loose",
      type: "label",
      position: { x: 0, y: gridTop - 36 },
      selectable: false,
      connectable: false,
      data: {
        text: "Bez powiązań - przeciągnij strzałkę od jednego do drugiego, żeby je połączyć",
      },
    });
  }
  return cards;
});

const byId = computed(() => new Map(props.all.map((t) => [t.id, t])));
const selectedEdge = ref<string | null>(null);

const edges = computed<Edge[]>(() =>
  folds.value.edges.map(({ source, target, pairs: stands }) => {
    const id = `${source}->${target}`;
    const done = isClosed(byId.value.get(source)!);
    // An arrow into a folded card may stand for what a task folded inside it
    // waits on. Taking it away here would take away a different dependency
    // from the one it looks like, so it is only drawn.
    const intoFold = stands.some(([, dependent]) => dependent !== target);
    return {
      id,
      source,
      target,
      markerEnd: MarkerType.ArrowClosed,
      // A dependency already met is drawn but out of the way: it is the
      // record of the order, not something still in anybody's path.
      class: [
        "task-edge",
        done ? "task-edge--met" : "task-edge--open",
        intoFold ? "task-edge--into-fold" : "",
        id === selectedEdge.value ? "task-edge--selected" : "",
      ].join(" "),
      interactionWidth: intoFold ? 0 : 18,
      data: { intoFold },
    };
  }),
);

const edgeShown = computed(() => {
  const edge = edges.value.find((e) => e.id === selectedEdge.value);
  if (!edge) return null;
  const prerequisite = byId.value.get(edge.source);
  const dependent = byId.value.get(edge.target);
  return prerequisite && dependent ? { prerequisite, dependent } : null;
});

/** Refuses, while dragging, what the list would refuse: a task waiting on
 * itself, twice on one task, or in a loop. The handle shows it.
 *
 * Given to the handles rather than to VueFlow: VueFlow also runs its own
 * `isValidConnection` over every edge it is handed, and each existing arrow
 * is a dependency already there - which this refuses - so none would draw. */
function isValidConnection(connection: Connection) {
  const dependent = byId.value.get(connection.target);
  if (!dependent || dependent.dependsOn.includes(connection.source)) {
    return false;
  }
  return !dependencyProblem(
    props.all,
    dependent.id,
    [...dependent.dependsOn, connection.source],
    dependent.dependsOn,
  );
}

function onConnect(connection: Connection) {
  // Dropped on the bar over the map: the mark there is what was meant, not a
  // card that happens to lie under it. `onConnectEnd` makes that one.
  if (dragFrom.value && markAt(lastPoint)) return;
  if (connection.source && connection.target) {
    emit("connect", connection.source, connection.target);
  }
}

function disconnect() {
  const shown = edgeShown.value;
  if (!shown) return;
  emit("disconnect", shown.prerequisite.id, shown.dependent.id);
  selectedEdge.value = null;
}

/** Everything on the map, from the layout rather than from Vue Flow's
 * measurements: those arrive a frame or more after the cards do, and a fit
 * made before them misses. With room above it for the bar over the map. */
const bounds = computed(() => {
  const points = [...placement.value.positions.values()];
  if (points.length === 0) return null;
  const x = Math.min(...points.map((p) => p.x));
  const top = Math.min(
    ...points.map((p) => p.y),
    // The label over the loose tasks sits above the first of them.
    placement.value.gridTop !== null ? placement.value.gridTop - 36 : Infinity,
  );
  const bottom = Math.max(...points.map((p) => p.y)) + TASK_NODE_HEIGHT;
  const room = Math.max(60, (bottom - top) * 0.1);
  return {
    x,
    y: top - room,
    width: Math.max(...points.map((p) => p.x)) + TASK_NODE_WIDTH - x,
    height: bottom - top + room,
  };
});

/** Fits everything into view. Animated only when asked for with the button:
 * an automatic fit is a jump, because a click during the animation - d3-zoom
 * stops a running transition on any pointer down - would leave the map
 * wherever the animation had got to. */
const fit = (duration = 0) => {
  if (bounds.value) void fitBounds(bounds.value, { padding: 0.05, duration });
};

onPaneReady(() => fit());

/** A task picked while the map did not draw it: a filter or a focus left it
 * out. The page clears those to show it, and it is brought into view once it
 * is drawn. */
let awaited: string | null = null;

// A different set of tasks - another filter, or a focus - is looked at whole
// again, unless it came to show a task picked from outside the map, or it is
// the rest of the map coming back around a card whose focus was left. An
// arrow drawn or taken away keeps the view where it is.
watch(
  [() => [...shownIds.value].sort().join(","), () => props.focused],
  async () => {
    const wanted = awaited;
    const from = leaving;
    awaited = null;
    leaving = null;
    await nextTick();
    const to = from && placement.value.positions.get(from.id);
    if (wanted && shownIds.value.includes(wanted)) void bringIntoView(wanted);
    else if (from && to) holdStill(from.at, to);
    else fit();
  },
);

/** Brings a task into the middle, close enough to read, out of any fold it
 * was in. */
async function bringIntoView(id: string) {
  if (reveal(id)) await nextTick();
  const position = placement.value.positions.get(id);
  if (!position) {
    awaited = id;
    return;
  }
  setCenter(
    position.x + TASK_NODE_WIDTH / 2,
    position.y + TASK_NODE_HEIGHT / 2,
    { zoom: Math.max(viewport.value.zoom, 0.8), duration: 300 },
  );
}

// A task picked elsewhere - a link, or "Blokuje" beside the map - is brought
// into view.
watch(
  () => props.selected,
  (id) => {
    const fromMap = id === clicked;
    clicked = null;
    awaited = null;
    if (id && !fromMap) void bringIntoView(id);
  },
);

// ---- the bar over the map ----

/** The goals on the map and the folded cards, to drop an arrow on from
 * anywhere: the goals first, then the folds, each by name. */
const marks = computed<TaskMark[]>(() => {
  const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title, "pl");
  const goals = props.tasks
    .filter((task) => task.kind === "goal")
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)) || byTitle(a, b));
  const stacked = [...folds.value.stacks.keys()]
    .flatMap((id) => byId.value.get(id) ?? [])
    .filter((task) => task.kind !== "goal")
    .sort(byTitle);
  return [
    ...goals.map((task) => {
      const { closed, total } = goalProgress(props.all, task.id);
      return {
        id: task.id,
        title: task.title,
        kind: "goal" as const,
        count: `${closed}/${total}`,
        stacked: folds.value.stacks.has(task.id),
        closed: isClosed(task),
      };
    }),
    ...stacked.map((task) => ({
      id: task.id,
      title: task.title,
      kind: "fold" as const,
      count: `+${folds.value.stacks.get(task.id)}`,
      stacked: true,
      closed: isClosed(task),
    })),
  ];
});

/** Where an arrow being drawn started: which card, and which edge of it - the
 * right edge says "this first", the left "this waits on". */
const dragFrom = ref<{
  nodeId: string;
  handleType: "source" | "target";
} | null>(null);
/** The mark under the arrow's end, if it is over one. */
const drop = ref<{ id: string; valid: boolean } | null>(null);

function pointOf(event: MouseEvent | TouchEvent): Point | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/** The mark at a point on the screen. */
function markAt(point: Point | null): string | null {
  if (!point) return null;
  const element = document.elementFromPoint(point.x, point.y);
  return (
    element?.closest<HTMLElement>("[data-task-mark]")?.dataset.taskMark ?? null
  );
}

/** The dependency dropping an arrow from `from` on `mark` would make. */
const linkTo = (
  from: { nodeId: string; handleType: "source" | "target" },
  mark: string,
) =>
  from.handleType === "source"
    ? { source: from.nodeId, target: mark }
    : { source: mark, target: from.nodeId };

let lastPoint: Point | null = null;

function trackDrag(event: MouseEvent | TouchEvent) {
  lastPoint = pointOf(event);
  const mark = markAt(lastPoint);
  // Near the edge of the map Vue Flow moves the map along to where the arrow
  // is going; over the bar that is not where it is going.
  if (mark) autoPanOnConnect.value = false;
  drop.value =
    mark && dragFrom.value
      ? {
          id: mark,
          valid: isValidConnection({
            ...linkTo(dragFrom.value, mark),
            sourceHandle: null,
            targetHandle: null,
          }),
        }
      : null;
}

onConnectStart(({ nodeId, handleType }) => {
  if (!nodeId || !handleType) return;
  dragFrom.value = { nodeId, handleType };
  lastPoint = null;
  document.addEventListener("mousemove", trackDrag);
  document.addEventListener("touchmove", trackDrag);
});

onConnectEnd((event) => {
  document.removeEventListener("mousemove", trackDrag);
  document.removeEventListener("touchmove", trackDrag);
  const mark = markAt((event && pointOf(event)) ?? lastPoint);
  if (dragFrom.value && mark) {
    const { source, target } = linkTo(dragFrom.value, mark);
    emit("connect", source, target);
  }
  dragFrom.value = null;
  drop.value = null;
  lastPoint = null;
  autoPanOnConnect.value = true;
});

/** A mark clicked: the end of an arrow started by tapping a card's edge, or
 * otherwise the task, brought into view and opened. */
function pickMark(id: string) {
  const start = connectionClickStartHandle.value;
  if (start?.nodeId) {
    const { source, target } = linkTo(
      { nodeId: start.nodeId, handleType: start.type },
      id,
    );
    endConnection(undefined, true);
    emit("connect", source, target);
    return;
  }
  if (id === props.selected) void bringIntoView(id);
  else emit("select", id);
}
</script>

<style>
.task-map {
  position: relative;
  height: 72vh;
  min-height: 420px;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface-muted));
}

.task-map__label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  white-space: nowrap;
  pointer-events: none;
}

.task-map .vue-flow__node-label {
  cursor: default;
}

.task-map .task-edge .vue-flow__edge-path {
  stroke: rgb(var(--v-theme-ink-neutral));
  stroke-width: 1.75;
}

.task-map .task-edge--met .vue-flow__edge-path {
  stroke-dasharray: 5 5;
  opacity: 0.45;
}

.task-map .task-edge--selected .vue-flow__edge-path,
.task-map .task-edge:hover .vue-flow__edge-path {
  stroke: rgb(var(--v-theme-ink-danger));
  stroke-width: 2.5;
  opacity: 1;
}

/* Drawn only: see `edges`. */
.task-map .task-edge--into-fold {
  pointer-events: none;
}

.task-map__tools {
  position: absolute;
  inset-block-end: 12px;
  inset-inline-end: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 5;
}

/* At the bottom, where the bar over the map leaves room: clear of the zoom
 * buttons on the right. */
.task-map__edge-bar {
  position: absolute;
  inset-block-end: 12px;
  inset-inline: 12px 64px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 5;
}

.task-map__edge-bar > span {
  flex: 1 1 240px;
}
</style>

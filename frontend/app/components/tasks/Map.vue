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
      @edge-click="({ edge }) => (selectedEdge = edge.id)"
      @pane-click="selectedEdge = null"
    >
      <template #node-task="{ data }">
        <TasksMapNode
          :task="data.task"
          :state="data.state"
          :section="data.section"
          :selected="data.task.id === selected"
          :faded="data.faded"
          :valid-connection="isValidConnection"
        />
      </template>
      <template #node-label="{ data }">
        <div class="task-map__label">{{ data.text }}</div>
      </template>
    </VueFlow>

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
  placeTasks,
} from "~/utils/taskGraph";
import {
  dependencyProblem,
  isClosed,
  taskSection,
  type Task,
  type TaskState,
} from "~~/shared/tasks";

/** The task list as a flowchart: an arrow from each task to what waits on it,
 * laid out left to right so the first column is what can be started.
 *
 * The layout is computed, never dragged: every arrow drawn or taken away lays
 * the map out again, and a hand-placed card would be moved anyway. What the
 * map is for is joining tasks - drag from the right edge of the task that has
 * to happen first to the left edge of the one that waits (or tap one edge,
 * then the other) - and seeing the chains that come out of it. */

const FLOW_ID = "tasks-map";

const props = defineProps<{
  /** The tasks on the map. */
  tasks: readonly Task[];
  /** Every task, for judging a new arrow against the whole list. */
  all: readonly Task[];
  states: Map<string, TaskState>;
  /** Shown only for context - joined to a task the filter kept. */
  faded?: ReadonlySet<string>;
  selected?: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  connect: [prerequisite: string, dependent: string];
  disconnect: [prerequisite: string, dependent: string];
}>();

const { fitBounds, zoomIn, zoomOut, setCenter, viewport, onPaneReady } =
  useVueFlow(FLOW_ID);

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

const placement = computed(() => placeTasks(shownIds.value, pairs.value));

const nodes = computed<Node[]>(() => {
  const { positions, gridTop } = placement.value;
  const cards: Node[] = props.tasks.map((task) => {
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
        faded: props.faded?.has(task.id) ?? false,
      },
    };
  });
  if (gridTop !== null && pairs.value.length > 0) {
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
  pairs.value.map(([prerequisite, dependent]) => {
    const id = `${prerequisite}->${dependent}`;
    const done = isClosed(byId.value.get(prerequisite)!);
    return {
      id,
      source: prerequisite,
      target: dependent,
      markerEnd: MarkerType.ArrowClosed,
      // A dependency already met is drawn but out of the way: it is the
      // record of the order, not something still in anybody's path.
      class: [
        "task-edge",
        done ? "task-edge--met" : "task-edge--open",
        id === selectedEdge.value ? "task-edge--selected" : "",
      ].join(" "),
      interactionWidth: 18,
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
 * made before them misses. */
const bounds = computed(() => {
  const points = [...placement.value.positions.values()];
  if (points.length === 0) return null;
  const x = Math.min(...points.map((p) => p.x));
  const y = Math.min(
    ...points.map((p) => p.y),
    // The label over the loose tasks sits above the first of them.
    placement.value.gridTop !== null ? placement.value.gridTop - 36 : Infinity,
  );
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) + TASK_NODE_WIDTH - x,
    height: Math.max(...points.map((p) => p.y)) + TASK_NODE_HEIGHT - y,
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

// A different set of tasks - another filter - is looked at whole again. An
// arrow drawn or taken away keeps the view where it is.
watch(
  () => [...shownIds.value].sort().join(","),
  async () => {
    await nextTick();
    fit();
  },
);

// A task picked elsewhere - a link, or "Blokuje" beside the map - is brought
// into the middle, close enough to read.
watch(
  () => props.selected,
  (id) => {
    const fromMap = id === clicked;
    clicked = null;
    const position = id ? placement.value.positions.get(id) : undefined;
    if (!position || fromMap) return;
    setCenter(
      position.x + TASK_NODE_WIDTH / 2,
      position.y + TASK_NODE_HEIGHT / 2,
      { zoom: Math.max(viewport.value.zoom, 0.8), duration: 300 },
    );
  },
);
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

.task-map__tools {
  position: absolute;
  inset-block-end: 12px;
  inset-inline-end: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 5;
}

.task-map__edge-bar {
  position: absolute;
  inset-block-start: 12px;
  inset-inline: 12px;
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

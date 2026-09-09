<template>
  <v-network-graph
    v-if="ready"
    ref="graph"
    :key="`${focusNodeId}-${Object.keys(nodes).length}-${(edges ?? []).length}`"
    v-model:selected-nodes="selectedNodes"
    v-model:zoom-level="zoomLevel"
    :nodes="nodes"
    :edges="edges"
    :configs="configs"
    :layouts="layoutCentered"
    :event-handlers="eventHandlers"
  >
    <!-- The whole node is drawn here rather than left to the library, because
         a coloured disc says only "somebody" and a grey square says only
         "something". The glyph inside says which, at every zoom, without
         reading the label - which at two hops is the difference between a
         picture and a word cloud.

         `override-node` and not `node`: the slot this component used to declare
         does not exist. v-network-graph passes any other slot name through to
         its layer machinery, so the circles and rectangles written there were
         never mounted, and the default renderer drew the nodes all along. -->
    <template #override-node="{ nodeId, scale, config }">
      <g :opacity="dimmed(nodeId) ? 0.18 : 1">
        <!-- The page's subject, ringed. It is pinned at the origin, but so is
             the reader's attention only until the layout settles. -->
        <circle
          v-if="nodeId === focusNodeId"
          :r="haloRadius(config) * scale"
          fill="none"
          :stroke="FOCUS_RING"
          :stroke-width="2 * scale"
          stroke-opacity="0.6"
        />
        <circle
          v-if="config.type === 'circle'"
          :r="config.radius * scale"
          :fill="config.color"
          :stroke="config.strokeColor"
          :stroke-width="config.strokeWidth * scale"
        />
        <rect
          v-else
          :x="(-config.width * scale) / 2"
          :y="(-config.height * scale) / 2"
          :width="config.width * scale"
          :height="config.height * scale"
          :rx="config.borderRadius * scale"
          :fill="config.color"
          :stroke="config.strokeColor"
          :stroke-width="config.strokeWidth * scale"
        />
        <path
          :d="entityGlyph(nodes[nodeId]?.entityType)"
          :fill="readableInk(nodes[nodeId]?.color)"
          :transform="glyphTransform(config, scale)"
        />
      </g>
    </template>

    <!-- v-network-graph only mounts its label layer when this slot is present
         (`"edge-label" in $slots`), so the `v-if` is what makes "off" cost
         nothing rather than draw empty text on every line. That is also why
         the `edge.label` config below had no effect until now. -->
    <template v-if="edgeLabels" #edge-label="slotProps">
      <v-edge-label
        v-bind="slotProps"
        :text="edgeText(slotProps.edge)"
        align="center"
        vertical-align="above"
      />
    </template>
  </v-network-graph>

  <div v-else class="d-flex justify-center" width="100%">
    <v-progress-circular indeterminate />
    Ładuję...
  </div>
</template>

<script setup lang="ts">
import { defineConfigs, SimpleLayout } from "v-network-graph";
import type {
  EventHandlers,
  Instance,
  NodeEvent,
  ShapeStyle,
} from "v-network-graph";
import { useSimulationStore } from "@/stores/simulation";
import type { Node as GraphNode, NodeStats, Edge } from "~~/shared/graph/model";
import { edgeStyle } from "~~/shared/graph/edges";
import { personLabel, wrapLabel } from "~/utils/graphLabel";
import { entityGlyph } from "~/utils/entityIcon";
import { graphNodeDestination, readableInk } from "~/utils/graphNode";

/** A node as it arrives: `getNodes` stamps the group headcount onto it, and the
 * spec for this component mounts nodes without one.
 *
 * v-network-graph hands a config callback the node object and nothing else, so
 * everything the styling below keys off - the id, the ring, the kind - has to
 * be on the node itself. It all is; see `shared/graph/model.ts`. */
type CanvasNode = GraphNode & { stats?: NodeStats };

const props = defineProps<{
  nodes: Record<string, CanvasNode>;
  edges: Edge[];
  ready: boolean;
  focusNodeId?: string;
  /** Draw what kind of relation each line is, along the line. Off unless the
   * reader asked for it on the bar above. */
  edgeLabels?: boolean;
}>();

const simulationStore = useSimulationStore();
const router = useRouter();

const emit = defineEmits<{
  (e: "select", nodeId: string | undefined): void;
}>();

/** Sage, a shade darker than the theme's primary, which is too pale to read as
 * a ring against a white canvas. */
const FOCUS_RING = "#5f7a54";

/** How wide a node is drawn, by how far it is from the page's subject.
 *
 * The subject is largest, its own relations next, and the ring beyond them
 * small enough to read as background. A flat two hop graph is forty equal dots
 * and no way to tell whose page you are on. */
const RING_WIDTH: Record<number, number> = { 0: 46, 1: 34, 2: 24 };
const RING_LABEL: Record<number, number> = { 0: 13, 1: 11.5, 2: 9.5 };

function ringOf(node: GraphNode): number {
  return Math.min(node.depth ?? 1, 2);
}

function nodeWidth(node: GraphNode): number {
  return (node.sizeMult ?? 1) * (RING_WIDTH[ringOf(node)] ?? 34);
}

const layoutCentered = computed(() => {
  if (!props.focusNodeId) return {};
  const layout: {
    nodes: Record<string, { x: number; y: number; fixed?: boolean }>;
  } = {
    nodes: {},
  };
  layout.nodes[props.focusNodeId] = { x: 0, y: 0, fixed: true };
  return layout;
});

/** What the reader has clicked. The library maintains this itself; the watch
 * below holds it to one at a time, because the point of a selection here is to
 * answer "and what is this one attached to", and two overlapping answers is the
 * crowd the highlight exists to cut through. Shift-clicking is how a second one
 * gets in. */
const selectedNodes = ref<string[]>([]);
const hoveredNode = ref<string | undefined>(undefined);

watch(selectedNodes, (ids) => {
  if (ids.length > 1) {
    selectedNodes.value = [ids[ids.length - 1]!];
    return;
  }
  emit("select", ids[0]);
});

/** The node the canvas is answering "and what is this one attached to" about:
 * whatever is under the pointer, or failing that whatever was last clicked.
 * Named once, because the nodes and the edges both dim against it, and dimming
 * them by two copies of the rule is how they come to disagree. */
const activeId = computed(() => hoveredNode.value ?? selectedNodes.value[0]);

/** The active node and everything one relation from it. Everything else on the
 * canvas is dimmed to the point of being background, which is the only way a
 * name in the middle of a two hop graph can be read at all. */
const highlighted = computed<Set<string> | undefined>(() => {
  const id = activeId.value;
  if (!id) return undefined;
  const near = new Set<string>([id]);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  for (const edge of props.edges ?? []) {
    if (edge.source === id) near.add(edge.target);
    if (edge.target === id) near.add(edge.source);
  }
  return near;
});

function dimmed(nodeId: string | undefined): boolean {
  return !!highlighted.value && !!nodeId && !highlighted.value.has(nodeId);
}

function dimmedEdge(edge: Edge): boolean {
  const id = activeId.value;
  if (!id) return false;
  return edge.source !== id && edge.target !== id;
}

/** The ring drawn around the page's subject, just outside its shape. */
function haloRadius(config: ShapeStyle): number {
  const half =
    config.type === "circle"
      ? config.radius
      : Math.max(config.width, config.height) / 2;
  return half + 6;
}

/** Places the 24x24 material path at the middle of the node, scaled to sit
 * inside it with room to spare. */
function glyphTransform(config: ShapeStyle, scale: number): string {
  const box =
    config.type === "circle"
      ? config.radius * 2
      : Math.min(config.width, config.height);
  const size = box * 0.56 * scale;
  return `translate(${-size / 2} ${-size / 2}) scale(${size / 24})`;
}

/** What a line says when the labels are switched on.
 *
 * `edge.label` and not a table of our own: `shared/graph/util.ts` already
 * settles this as `edge.name ?? edgeLabel[edge.type]`, so a relation somebody
 * named - an employment's job title - says that, and an unnamed one falls back
 * to the same word the rest of the site uses for its kind. A second table here
 * would be a second answer to the same question. */
function edgeText(edge: Edge): string {
  return edge.label ?? "";
}

/** Opening a node's page, on a double click.
 *
 * A single click is not bound at all: the library's own selection handles it
 * (`selectable: true` below), and selecting is what draws the highlight. This
 * used to be bound to `node:click` as well, behind an `event.detail !== 2`
 * guard - but v-network-graph builds the second click and the double click from
 * one init object and dispatches both, so the navigation ran twice.
 */
const handleNodeDoubleClick = ({ node }: NodeEvent<MouseEvent>) => {
  const nodeWhole = props.nodes[node];
  if (!nodeWhole) return;

  const destination = graphNodeDestination(nodeWhole);
  if (!destination) return;
  router.push({ path: `/entity/${destination}/${node}` });
};

const handleDoubleClick = () => {
  navigateTo("/edit/node/new");
};

const eventHandlers: EventHandlers = {
  "view:dblclick": handleDoubleClick,
  "node:dblclick": handleNodeDoubleClick,
  "node:pointerover": ({ node }) => {
    hoveredNode.value = node;
  },
  "node:pointerout": () => {
    hoveredNode.value = undefined;
  },
};

/** The shape of a node, `grow` pixels wider than it is drawn at rest.
 *
 * `document` is not a shape v-network-graph knows - it always fell through to
 * the rectangle branch by accident. Said out loud here so a region is a
 * rectangle on purpose, told apart from a company by its glyph and its colour
 * rather than by nothing at all.
 *
 * Circles are sized by `radius`, rectangles by `width`/`height`, and only the
 * latter were ever set - so `sizeMult` did nothing to a person and the
 * library's default 16px radius drew every one of them the same size.
 */
function nodeShape(grow: number) {
  const across = (node: CanvasNode) => nodeWidth(node) + grow;
  return {
    type: (node: CanvasNode) =>
      node.type === "circle" ? ("circle" as const) : ("rect" as const),
    radius: (node: CanvasNode) => across(node) / 2,
    width: across,
    height: (node: CanvasNode) =>
      across(node) * (node.type === "document" ? 0.8 : 1),
    borderRadius: (node: CanvasNode) => (node.type === "document" ? 2 : 7),
    color: (node: CanvasNode) => node.color,
  };
}

const configs = reactive(
  defineConfigs<CanvasNode, Edge>({
    node: {
      normal: {
        ...nodeShape(0),
        // A hairline of the page background, so two nodes the layout pushed
        // together still read as two.
        strokeWidth: (node) => (node.depth === 0 ? 2 : 1.5),
        strokeColor: (node) => (node.depth === 0 ? FOCUS_RING : "#ffffff"),
      },
      hover: {
        ...nodeShape(6),
        strokeWidth: 2.5,
        strokeColor: FOCUS_RING,
      },
      selectable: true,
      focusring: {
        visible: true,
        width: 3,
        padding: 3,
        color: FOCUS_RING,
      },
      // The subject over its own relations, and those over the outer ring, so
      // that where they overlap the nearer one is the one you can read.
      zOrder: {
        enabled: true,
        zIndex: (node) => 10 - ringOf(node),
        bringToFrontOnHover: true,
        bringToFrontOnSelected: true,
      },
      label: {
        // Point at a node and the rest of the canvas gives up its names. At two
        // hops there are more labels than there is room for them, and this is
        // what makes any one of them legible.
        visible: (node) => !dimmed(node.id),
        fontSize: (node) => RING_LABEL[ringOf(node)] ?? 11.5,
        color: "#1b1b1b",
        // Labels are drawn over whatever the layout put underneath them, and a
        // dense graph puts a lot there: without a plate behind the text, a name
        // crossing an edge or another name is unreadable rather than merely
        // crowded.
        background: {
          visible: true,
          color: "rgba(255, 255, 255, 0.86)",
          padding: { vertical: 1, horizontal: 3 },
          borderRadius: 3,
        },
        lineHeight: 1.1,
        margin: 5,
        directionAutoAdjustment: true,
        // A headcount for whatever holds people - an institution, or a region
        // through the institutions it owns. Not for a person: there it read as
        // a score nobody had defined, "Jan Kowalski (1)", because the same
        // group walk that counts who works at a company also counts who a
        // person knows.
        text: (node) => {
          // The outer ring is drawn narrow enough that a name has to give
          // something up; `personLabel` gives up the middle names rather than
          // the surname, which is what a reader is looking for.
          const width =
            ringOf(node) === 2 ? { maxChars: 14, maxLines: 2 } : undefined;
          if (node.type === "circle") return personLabel(node.name, width);

          const people = node.stats?.people ?? 0;
          const name = people ? `${node.name} (${people})` : node.name;
          return wrapLabel(name, width);
        },
      },
    },
    edge: {
      normal: {
        color: (edge) => (dimmedEdge(edge) ? "#dde2e5" : edgeStyle(edge).color),
        width: (edge) => edgeStyle(edge).width,
        dasharray: (edge) => edgeStyle(edge).dasharray ?? 0,
      },
      hover: {
        color: (edge) => edgeStyle(edge).color,
        width: (edge) => edgeStyle(edge).width + 1,
        dasharray: (edge) => edgeStyle(edge).dasharray ?? 0,
      },
      marker: {
        // Only ownership has a direction worth an arrowhead: a region owns a
        // company, never the other way about. Employment and acquaintance read
        // the same from either end.
        target: {
          type: ([edge]) => (edge.type === "owns" ? "arrow" : "none"),
          width: 3,
          height: 3,
          margin: 1,
          offset: 0,
          units: "strokeWidth",
          color: null,
        },
      },
      label: {
        fontSize: 11,
        color: "#000",
      },
    },

    view: {
      autoPanAndZoomOnLoad: "center-zero",
      scalingObjects: true,
      doubleClickZoomEnabled: false,
      minZoomLevel: 0.2,
      maxZoomLevel: 4,
    },
  }),
);

function applyLayoutHandler() {
  if (!configs.view) return;
  // Use simple layout if we show many nodes (typical for global view)
  //
  // `?? {}` despite `nodes` being declared required: this now runs immediately,
  // which is before a lazily rendered parent has anything to pass, and the spec
  // for this component mounts it with no props at all. eslint reads the
  // declared type and calls the guard unnecessary; the runtime disagrees.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (Object.keys(props.nodes ?? {}).length > 200 && !props.focusNodeId) {
    configs.view.layoutHandler = new SimpleLayout();
  } else {
    configs.view.layoutHandler = simulationStore.newForceLayout();
  }
}

/** `immediate`, and this is the whole bug it fixes.
 *
 * Both of these used to wait for a change. A page that already had its graph in
 * hand when it first rendered - a reload, where the server sends the data with
 * the markup - therefore changed neither: the nodes arrived with the first
 * render and the focus node is pinned by a `key`, so it never moves either.
 * Nothing installed a layout handler, v-network-graph fell back to its default,
 * and every node without an explicit position was drawn at the same spot, one
 * circle on top of another.
 *
 * It looked like the force simulation pulling nodes together. It was the
 * simulation never being asked to run. The giveaway was that it only happened
 * on a refresh, and never on the topic page - which fetches its layout lazily,
 * so its data always arrives after mount and always trips the watcher.
 */
watch([() => props.nodes, () => props.focusNodeId], applyLayoutHandler, {
  immediate: true,
});

const graph = ref<Instance | null>(null);
const zoomLevel = ref(1);

/** How far in the automatic framing is allowed to go.
 *
 * `fitToContents` on a graph of five nodes zooms until those five fill the
 * canvas, and with `scalingObjects` the nodes grow with it - a person and two
 * employers came out the size of coins. Past this the view is centred instead
 * of magnified. */
const MAX_AUTO_ZOOM = 1.25;

/** Put the whole graph in frame.
 *
 * `autoPanAndZoomOnLoad: "center-zero"` puts the origin in the middle and stops
 * there, which was right when the canvas held a node and its handful of
 * relations. Two hops out the layout spreads well past the viewport, and the
 * subject - pinned at the origin - ends up in the middle of a picture whose
 * edges are off screen.
 */
async function fitView() {
  const instance = graph.value;
  if (!instance) return;
  await instance.fitToContents({ margin: "8%" });
  if (zoomLevel.value > MAX_AUTO_ZOOM) {
    zoomLevel.value = MAX_AUTO_ZOOM;
    await instance.panToCenter();
  }
}

/** The force layout animates for a second or so after the data lands, so the
 * frame is taken once it has stopped moving rather than around the positions it
 * started from.
 *
 * On the node count as well as on `ready`, because the two things that change
 * the picture after the first render - switching the reach in the bar, and
 * expanding a node - never make it not-ready, and both leave a graph that no
 * longer fits the frame taken for the old one. */
let fitTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  () => [props.ready, Object.keys(props.nodes ?? {}).length] as const,
  ([isReady]) => {
    if (!isReady || !import.meta.client) return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => void fitView(), 1600);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(fitTimer));

defineExpose({ fitView });
</script>

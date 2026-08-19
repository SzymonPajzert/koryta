<template>
  <v-network-graph
    v-if="ready"
    :key="`${focusNodeId}-${Object.keys(nodes).length}-${(edges ?? []).length}`"
    :nodes="nodes"
    :edges="edges"
    :configs="configs"
    :layouts="layoutCentered"
    :event-handlers="eventHandlers"
  >
    <template #node="{ node, config }">
      <circle
        v-if="node?.type === 'circle'"
        :r="config.node.normal.width(node) / 2"
        :fill="config.node.normal.color(node)"
      />
      <rect
        v-else-if="node?.type === 'rect'"
        :width="config.node.normal.width(node)"
        :height="config.node.normal.height(node)"
        :x="-config.node.normal.width(node) / 2"
        :y="-config.node.normal.height(node) / 2"
        :fill="config.node.normal.color(node)"
      />
    </template>

    <template #override-node>
      <!-- Let's just use the `#view` or `#override-node-label` (v-network-graph has `#override-node-label`?) -->
      <!-- Ah, v-network-graph has no override-node-label slot directly, it has `<template #node="{ node }">` -->
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
  NodeEvent,
  Edge as CanvasEdge,
} from "v-network-graph";
import { useSimulationStore } from "@/stores/simulation";
import type { NodeType } from "~~/shared/model";
import type { Node as GraphNode, Edge } from "~~/shared/graph/model";
import { wrapLabel } from "~/utils/graphLabel";

const props = defineProps<{
  nodes: Record<string, GraphNode>;
  edges: Edge[];
  ready: boolean;
  focusNodeId?: string;
}>();

const simulationStore = useSimulationStore();
const router = useRouter();

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

const emit = defineEmits<{
  (e: "expand", nodeId: string): void;
}>();

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  const nodeWhole = props.nodes[node];
  if (!nodeWhole) return;

  if (event.detail !== 2) {
    // Single click: expand the node to show immediate neighbors
    emit("expand", node);
  } else {
    // Double click: navigate
    let destination: NodeType | undefined = undefined;
    switch (nodeWhole.type) {
      case "rect":
        destination = "place";
        break;
      case "circle":
        destination = "person";
        break;
      case "document":
        destination = "teryt" in nodeWhole ? "region" : "article";
        break;
    }

    router.push({ path: `/entity/${destination}/${node}` });
  }
};

const handleDoubleClick = () => {
  navigateTo("/edit/node/new");
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "view:dblclick": handleDoubleClick,
  "node:dblclick": handleNodeClick,
};

/** Whether this line is an inference rather than a recorded relation.
 *
 * v-network-graph hands a style callback its own edge type, which is `source`,
 * `target` and an index signature, so `type` arrives as `any` and the check is
 * written once here rather than three times inline. */
const isDerived = (edge: CanvasEdge) => edge.type === "co_candidate";

const configs = reactive(
  defineConfigs({
    node: {
      normal: {
        type: (node) => node.type,
        width: (node) => (node.sizeMult ?? 1) * 32,
        height: (node) => (node.sizeMult ?? 1) * 32,
        color: (node) => node.color,
      },
      label: {
        color: "#000",
        // Labels are drawn over whatever the layout put underneath them, and a
        // dense graph puts a lot there: without a plate behind the text, a name
        // crossing an edge or another name is unreadable rather than merely
        // crowded.
        background: {
          visible: true,
          color: "rgba(255, 255, 255, 0.82)",
          padding: { vertical: 1, horizontal: 3 },
          borderRadius: 3,
        },
        lineHeight: 1.1,
        text: (node) =>
          wrapLabel(
            node.stats?.people
              ? `${node.name ?? ""} (${node.stats.people})`
              : (node.name ?? ""),
          ),
      },
    },
    edge: {
      // A `co_candidate` edge is drawn thin, grey and dashed, and every other
      // edge keeps v-network-graph's defaults. Nobody wrote that relation down:
      // it is worked out from two candidacies naming the same list, so it must
      // not look like the lines a reader can click through to a source.
      normal: {
        width: (edge) => (isDerived(edge) ? 1.5 : 2),
        color: (edge) => (isDerived(edge) ? "#9e9e9e" : "#4466cc"),
        dasharray: (edge) => (isDerived(edge) ? "4 3" : 0),
      },
      label: {
        fontSize: 11,
        color: "000",
      },
    },

    view: {
      autoPanAndZoomOnLoad: "center-zero",
      scalingObjects: true,
      doubleClickZoomEnabled: false,
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
</script>

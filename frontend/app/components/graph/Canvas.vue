<template>
  <v-network-graph
    v-if="ready"
    :key="`${focusNodeId}-${Object.keys(nodes).length}-${(edges ?? []).length}`"
    :nodes="nodes"
    :edges="edges"
    :configs="configs"
    :layouts="layout"
    :event-handlers="eventHandlers"
  >
    <template #node="{ node, config }">
      <circle
        v-if="node.type === 'circle'"
        :r="config.node.normal.width(node) / 2"
        :fill="config.node.normal.color(node)"
      />
      <rect
        v-else-if="node.type === 'rect'"
        :width="config.node.normal.width(node)"
        :height="config.node.normal.height(node)"
        :x="-config.node.normal.width(node) / 2"
        :y="-config.node.normal.height(node) / 2"
        :fill="config.node.normal.color(node)"
      />
      <!-- We don't redefine the whole node svg shape unless we want to, wait, v-network-graph requires us to redefine it all if we use `#node`? -->
      <!-- Actually we can just use the label slot! -->
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
import type { EventHandlers, NodeEvent } from "v-network-graph";
import { useSimulationStore } from "@/stores/simulation";
import type { NodeType } from "~~/shared/model";
import type { Node as GraphNode, Edge } from "~~/shared/graph/model";

const props = defineProps<{
  nodes: Record<string, GraphNode>;
  edges: Edge[];
  layout?: { nodes: Record<string, { x: number; y: number }> };
  ready: boolean;
  focusNodeId?: string;
}>();

const simulationStore = useSimulationStore();
const router = useRouter();

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
        destination = (nodeWhole as any).teryt ? "region" : "article";
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
        text: (node) =>
          node.stats?.people
            ? `${node.name ?? ""} (${node.stats.people})`
            : (node.name ?? ""),
      },
    },
    edge: {
      label: {
        fontSize: 11,
        color: "000",
      },
    },

    view: {
      autoPanAndZoomOnLoad: "fit-content",
      scalingObjects: true,
      doubleClickZoomEnabled: false,
    },
  }),
);

watch(
  () => props.nodes,
  () => {
    if (!configs.view) return;
    // Use simple layout if we show many nodes (typical for global view)
    if (Object.keys(props.nodes).length > 200 && !props.focusNodeId) {
      configs.view.layoutHandler = new SimpleLayout();
    } else {
      configs.view.layoutHandler = simulationStore.newForceLayout();
    }
  },
);

watch(
  () => props.focusNodeId,
  () => {
    if (!configs.view) return;
    configs.view.layoutHandler = simulationStore.newForceLayout();
  },
);
</script>

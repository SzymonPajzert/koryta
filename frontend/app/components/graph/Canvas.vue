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
    <template #edge-label="{ edge, ...slotProps }">
      <v-edge-label
        :text="edge.label"
        align="center"
        vertical-align="above"
        v-bind="slotProps"
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
import type { EventHandlers, NodeEvent } from "v-network-graph";
import { useSimulationStore } from "@/stores/simulation";
import type { NodeType } from "~~/shared/model";
import type { Node as GraphNode } from "~~/shared/graph/model";

const props = defineProps<{
  nodes: Record<string, GraphNode>;
  edges: any[];
  layout?: { nodes: Record<string, { x: number; y: number }> };
  ready: boolean;
  focusNodeId?: string;
}>();

const simulationStore = useSimulationStore();
const router = useRouter();

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  const nodeWhole = props.nodes[node];
  if (!nodeWhole) return;

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

  if (event.detail !== 2) {
    if (destination) {
      router.push({ path: `/entity/${destination}/${node}` });
    }
  } else {
    // optional chaining
    if (props.nodes[node]?.type === "rect") {
      router.push({ query: { miejsce: node } });
    }
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

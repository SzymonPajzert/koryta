<script setup lang="ts">
import { defineConfigs } from "v-network-graph";
import {
  type EventHandlers,
  type NodeEvent,
  type ViewEvent,
  type LayoutHandler,
  SimpleLayout,
} from "v-network-graph";

import { useDialogStore } from "@/stores/dialog";
import { useSimulationStore } from "@/stores/simulation";
import { useGraphStore } from "@/stores/graph";

const dialogStore = useDialogStore();
const graphStore = useGraphStore();
const simulationStore = useSimulationStore();

const { runSimulation } = storeToRefs(simulationStore);
const { nodes, edges, nodesFiltered } = storeToRefs(graphStore)

const handleNodeClick = ({ node }: NodeEvent<MouseEvent>) => {
  dialogStore.openExisting(node);
};

const handleDoubleClick = (event: ViewEvent<MouseEvent>) => {
  dialogStore.openMain();
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "view:dblclick": handleDoubleClick,
};

const configs = defineConfigs({
    node: {
      normal: {
        type: (node) => node.type,
        width: (node) => (node.sizeMult ?? 1) * 32,
        height: (node) => (node.sizeMult ?? 1) * 32,
        color: (node) => node.color,
      },
      label: {
        color: "#fff",
      },
    },
    edge: {
      label: {
        fontSize: 11,
        color: "#fff",
      },
    },
    view: {
      scalingObjects: true,
      layoutHandler: markRaw(simulationStore.newForceLayout(true) as LayoutHandler),
      doubleClickZoomEnabled: false,
    },
  })

watch(runSimulation, (value) => {
  if (value) {
    configs.view.layoutHandler = simulationStore.newForceLayout(false);
  } else {
    configs.view.layoutHandler = new SimpleLayout();
  }
});

const layouts = ref()
watch(layouts, console.log)
</script>

<template>
  <v-network-graph
    :nodes="nodesFiltered ?? nodes"
    :edges="unref(edges)"
    :configs="configs"
    :layouts="layouts"
    :eventHandlers="eventHandlers"
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
</template>

<script setup lang="ts">
definePage({
  meta: {
    title: "Graf",
    isGraph: true,
  },
});

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
const { nodes, edges } = storeToRefs(graphStore);
import router from "@/router";
import { useParams } from "@/composables/params";

const interestingNodes = computed(() => {
  return Object.fromEntries(
    // TODO make it a parameter
    Object.entries(nodes.value).filter(
      ([_, node]) => node.type !== "rect" || node.stats.people > 0,
    ),
  );
});

const { filtered } = useParams("Graf ");

const nodesFiltered = computed(() => {
  return Object.fromEntries(
    Object.entries(interestingNodes.value).filter(([key, _]) =>
      filtered.value.includes(key),
    ),
  );
});

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  if (event.detail !== 2) {
    dialogStore.openExisting(node);
  } else {
    if (nodesFiltered.value[node].type === "rect") {
      // TODO add previous place
      router.push({ query: { miejsce: node } });
    }
  }
};

const handleDoubleClick = (event: ViewEvent<MouseEvent>) => {
  dialogStore.openMain();
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
      layoutHandler: simulationStore.newForceLayout(true) as LayoutHandler,
      doubleClickZoomEnabled: false,
    },
  }),
);

watch(nodesFiltered, () => {
  configs.view.layoutHandler = simulationStore.newForceLayout(true);
});

watch(runSimulation, (value) => {
  if (!configs.view) return;
  if (value) {
    configs.view.layoutHandler = simulationStore.newForceLayout(false);
  } else {
    configs.view.layoutHandler = new SimpleLayout();
  }
});
</script>

<template>
  <v-network-graph
    :nodes="nodesFiltered"
    :edges="unref(edges)"
    :configs="configs"
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

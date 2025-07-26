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
import { useRoute } from "vue-router";

const dialogStore = useDialogStore();
const graphStore = useGraphStore();
const simulationStore = useSimulationStore();

const { runSimulation } = storeToRefs(simulationStore);
const { nodes, edges } = storeToRefs(graphStore);
const { nodeGroupsMap } = storeToRefs(graphStore);
const route = useRoute<"/zobacz/graf/[[id]]">();
import router from "@/router";

const interestingNodes = computed(() => {
  return Object.fromEntries(
    // TODO make it a parameter
    Object.entries(nodes.value).filter(
      ([_, node]) => node.type !== "rect" || node.stats.people > 0,
    ),
  );
});

const nodesFiltered = computed(() => {
  if (route.params.id) {
    const nodeGroupPicked = nodeGroupsMap.value[route.params.id];
    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key, _]) =>
        nodeGroupPicked.connected.includes(key),
      ),
    );
  }
  return interestingNodes.value;
});

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  if (event.detail !== 2) {
    dialogStore.openExisting(node);
  } else {
    if (nodesFiltered.value[node].type === "rect") {
      router.push(`/zobacz/graf/${node}`);
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

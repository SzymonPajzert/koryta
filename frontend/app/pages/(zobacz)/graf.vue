<script setup lang="ts">
import { defineConfigs } from "v-network-graph";
import type { EventHandlers, NodeEvent } from "v-network-graph";

import { useDialogStore } from "@/stores/dialog";
import { useSimulationStore } from "@/stores/simulation";
import { useParams } from "@/composables/params";

definePageMeta({
  title: "Graf",
  isGraph: true,
});

const dialogStore = useDialogStore();
const simulationStore = useSimulationStore();
const { data: graph } = await useAsyncData(
  "graph",
  () => $fetch("/api/graph"),
  { lazy: true }
);
const { data: layout } = await useAsyncData(
  "layout",
  () => $fetch("/api/graphLayout"),
  { lazy: true }
);

const nodes = computed(() => graph.value?.nodes);
const edges = computed(() => graph.value?.edges);

const router = useRouter();

const interestingNodes = computed(() => {
  return Object.fromEntries(
    // TODO make it a parameter
    Object.entries(nodes.value ?? {}).filter(
      ([_, node]) => node.type !== "rect" || node.stats.people > 0
    )
  );
});

const { filtered } = useParams("Graf ");

const nodesFiltered = computed(() => {
  return Object.fromEntries(
    Object.entries(interestingNodes.value).filter(([key, _]) =>
      filtered.value.includes(key)
    )
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

const handleDoubleClick = () => {
  dialogStore.openMain();
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "view:dblclick": handleDoubleClick,
  "node:dblclick": handleNodeClick,
};

// TODO reenable reactive for simulation to show
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
    autoPanAndZoomOnLoad: "fit-content",
    scalingObjects: true,
    doubleClickZoomEnabled: false,
  },
});

watch(filtered, () => {
  // Don't run the simulation if it's the whole graph
  if (filtered.value.length === Object.keys(nodes.value ?? {}).length) return;
  configs.view.layoutHandler = simulationStore.newForceLayout(false);
});
</script>

<template>
  <v-network-graph
    v-if="graph && layout"
    :nodes="shallowRef(nodesFiltered)"
    :edges="shallowRef(edges)"
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
    <v-sheet v-for="n in 3" :key="n" class="ma-2 pa-2">
      justify-center
    </v-sheet>
  </div>
</template>

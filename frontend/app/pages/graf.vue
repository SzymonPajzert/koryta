<script setup lang="ts">
import { defineConfigs, SimpleLayout } from "v-network-graph";
import type { EventHandlers, NodeEvent } from "v-network-graph";

import { useDialogStore } from "@/stores/dialog";
import { useSimulationStore } from "@/stores/simulation";
import { useParams } from "@/composables/params";
import type { NodeType } from "~~/shared/model";

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
});

const dialogStore = useDialogStore();
const simulationStore = useSimulationStore();
const { data: graph } = await useAsyncData(
  "graph",
  () => $fetch("/api/graph"),
  { lazy: true },
);
const { data: layout } = await useAsyncData(
  "layout",
  () => $fetch("/api/graph/layout"),
  { lazy: true },
);

const nodes = computed(() => graph.value?.nodes);
const edges = computed(() => graph.value?.edges);

const router = useRouter();

const interestingNodes = computed(() => {
  return Object.fromEntries(
    Object.entries(nodes.value ?? {}).filter(
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
  console.log(event.detail);
  const nodeWhole = nodesFiltered.value[node];
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
      destination = "article";
      break;
  }

  if (event.detail !== 2) {
    if (destination) {
      router.push({ path: `/entity/${destination}/${node}` });
    }
  } else {
    // optional chaining
    if (nodesFiltered.value[node]?.type === "rect") {
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
      autoPanAndZoomOnLoad: "fit-content",
      scalingObjects: true,
      doubleClickZoomEnabled: false,
    },
  }),
);

watch(filtered, () => {
  if (!configs.view) return;
  if (filtered.value.length > 200) {
    // Don't run the simulation if it's the whole graph
    configs.view.layoutHandler = new SimpleLayout();
  } else configs.view.layoutHandler = simulationStore.newForceLayout();
});
</script>

<template>
  <v-network-graph
    v-if="graph && layout"
    :nodes="nodesFiltered"
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
    Ładuję...
  </div>
</template>

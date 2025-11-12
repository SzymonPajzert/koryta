<script setup lang="ts">
import { defineConfigs, SimpleLayout } from "v-network-graph";
import type { EventHandlers, NodeEvent } from "v-network-graph";

import { useDialogStore } from "@/stores/dialog";
import { useSimulationStore } from "@/stores/simulation";
import { useParams } from "@/composables/params";
import type { NodeType } from "~~/shared/model";

definePageMeta({
  isGraph: true,
  fullWidth: true,
});

const route = useRoute();
const { data: graph } = await useFetch("/api/graph", {
  query: {
    subgraph: (route.query.miejsce ?? "") as string,
  },
  lazy: true,
});
const { data: layout } = await useFetch("/api/graph/layout", { lazy: true });

const nodes = computed(() => graph.value?.nodes);
const edges = computed(() => graph.value?.edges);

const router = useRouter();
const { filterName } = useParams();
useHead({
  title: `Graf ${filterName.value}}`,
});

const dialogStore = useDialogStore();
const simulationStore = useSimulationStore();

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  console.log(event.detail);
  const nodeWhole = nodes.value[node];
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
    router.push({ path: `/entity/${destination}/${node}` });
  } else {
    if (nodes.value[node].type === "rect") {
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

watch(nodes, () => {
  if (nodes.value && Object.entries(nodes.value).length > 200) {
    // Don't run the simulation if it's the whole graph
    configs.view.layoutHandler = new SimpleLayout();
    // TODO show popup that the simulation stopped due to size
  } else configs.view.layoutHandler = simulationStore.newForceLayout();
});
</script>

<template>
  <v-network-graph
    v-if="graph && layout"
    :nodes="nodes"
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

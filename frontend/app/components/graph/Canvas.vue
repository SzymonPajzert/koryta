<template>
  <v-network-graph
    v-if="nodes"
    :nodes="nodesFiltered"
    :edges="edgesFiltered"
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
import { useParams } from "@/composables/params";
import type { NodeType } from "~~/shared/model";
import type { GraphLayout } from "~~/shared/graph/util";
import type { Node, NodeStats } from "~~/shared/graph/model";

const props = defineProps<{
  focusNodeId?: string;
  maxDepth?: number;
}>();

const simulationStore = useSimulationStore();
const { data: graph } = await useAsyncData<GraphLayout>(
  "graph",
  () => $fetch("/api/graph"),
  { lazy: true },
);
const { data: layout } = await useAsyncData<{
  nodes: Record<string, { x: number; y: number }>;
}>("layout", () => $fetch("/api/graph/layout"), { lazy: true });

const nodes = computed(() => graph.value?.nodes);
const edgesRaw = computed(() => graph.value?.edges);
const edges = useEntityFiltering(edgesRaw);
const nodesFiltered1 = useEntityFiltering(nodes);

const router = useRouter();

const interestingNodes = computed<Record<string, Node & { stats: NodeStats }>>(
  () => {
    return Object.fromEntries(
      Object.entries(nodesFiltered1.value ?? {}).filter(
        ([_, node]) => node.type !== "rect" || node.stats.people > 0,
      ),
    );
  },
);

const { filtered } = useParams("Graf ");

// TODO move it to the backend
const nodesFiltered = computed(() => {
  // console.log("Canvas.vue: focusNodeId", props.focusNodeId, "maxDepth", props.maxDepth);
  if (props.focusNodeId) {
    if (!graph.value) return {};
    const depth = props.maxDepth ?? 3;
    const visited = new Set<string>();
    const queue: { id: string; d: number }[] = [
      { id: props.focusNodeId, d: 0 },
    ];
    visited.add(props.focusNodeId);

    while (queue.length > 0 && !!edges.value) {
      const current = queue.shift()!;
      if (current.d >= depth) continue;

      const neighbors = edges.value
        .filter((e) => e.source === current.id || e.target === current.id)
        .map((e) => (e.source === current.id ? e.target : e.source));

      for (const neighborId of neighbors) {
        // Skip nodes that represent empty places or are otherwise filtered out
        if (!interestingNodes.value[neighborId]) continue;

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, d: current.d + 1 });
        }
      }
    }

    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key]) =>
        visited.has(key),
      ),
    );
  }

  return Object.fromEntries(
    Object.entries(interestingNodes.value).filter(([key, _]) =>
      filtered.value.includes(key),
    ),
  );
});

// We need to filter edges as well because v-network-graph might show edges connecting to non-existent nodes if we don't?
// Actually v-network-graph ignores edges where source/target are missing from `nodes`.
// But for performance or correctness let's filter them if in local mode.
const edgesFiltered = computed(() => {
  if (props.focusNodeId && graph.value) {
    const validNodeIds = new Set(Object.keys(nodesFiltered.value));
    return graph.value.edges.filter(
      (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
    );
  }
  return edges.value;
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

watch(filtered, () => {
  if (!configs.view) return;
  // Use simple layout if we show many nodes (typical for global view)
  // Check nodesFiltered size? or just filtered.value.length
  // Logic from original:
  if (filtered.value.length > 200 && !props.focusNodeId) {
    configs.view.layoutHandler = new SimpleLayout();
  } else {
    configs.view.layoutHandler = simulationStore.newForceLayout();
  }
});

// Also watch focusNodeId to trigger layout maybe?
watch(
  () => props.focusNodeId,
  () => {
    if (!configs.view) return;
    configs.view.layoutHandler = simulationStore.newForceLayout();
  },
);
</script>

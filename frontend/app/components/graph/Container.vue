<template>
  <GraphCanvas
    :nodes="nodesFiltered"
    :edges="edgesFiltered || []"
    :layout="layout || undefined"
    :ready="ready"
    :focus-node-id="focusNodeId"
    @expand="onExpandNode"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useGraph } from "~/composables/graph";

const props = defineProps<{
  focusNodeId?: string;
  maxDepth?: number;
  filtered?: string[];
}>();

const expandedNodes = ref(
  new Set<string>(props.focusNodeId ? [props.focusNodeId] : []),
);

const onExpandNode = (nodeId: string) => {
  const newSet = new Set(expandedNodes.value);
  newSet.add(nodeId);
  expandedNodes.value = newSet;
};

// Pass a reactive proxy combining props and expandedNodes
const opts = computed(() => ({
  ...props,
  expandedNodes,
}));

const { nodesFiltered, edgesFiltered, layout, ready } = useGraph(opts.value);
</script>

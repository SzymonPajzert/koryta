<template>
  <GraphCanvas
    :nodes="nodesFiltered"
    :edges="edgesFiltered || []"
    :layout="layout || undefined"
    :ready="ready"
    :focus-node-id="focusNodeId"
  />
</template>

<script setup lang="ts">
import { useGraph } from "~/composables/graph";

const props = defineProps<{
  focusNodeId?: string;
  maxDepth?: number;
  filtered?: string[];
}>();

const { nodesFiltered, edgesFiltered, layout, ready } = await useGraph(props);
</script>

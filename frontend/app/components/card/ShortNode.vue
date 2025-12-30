<template>
  <v-card
    :prepend-icon="icon(edge.richNode.type)"
    :title="edge.richNode.name"
    :subtitle="edge.label"
    :text="edge.richNode.content"
  />
</template>

<script setup lang="ts">
import type { NodeType } from "~~/shared/model";
import type { EdgeNode } from "~/composables/edges";

const { edge } = defineProps<{ edge: EdgeNode }>();

function icon(type: NodeType) {
  switch (type) {
    case "person":
      return "mdi-account-outline";
    case "place":
      return "mdi-office-building-outline";
    case "article":
      return "mdi-file-document-outline";
    default:
      return "mdi-comment-arrow-right-outline";
  }
}
</script>

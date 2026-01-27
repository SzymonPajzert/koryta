<template>
  <!-- TODO find a better place to contain somewhere information if they're currently employed -->
  <v-card
    :key="edge.richNode.id"
    :prepend-icon="icon(edge.richNode.type)"
    :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
    :class="{ 'bg-green-lighten-5': edge.start_date && !edge.end_date }"
  >
    <template #title>{{ edge.richNode.name }}</template>
    <template #subtitle>
      <div>{{ edge.label }}</div>
      <div v-if="edge.start_date || edge.end_date" class="text-caption">
        {{ edge.start_date }} - {{ edge.end_date || "obecnie" }}
      </div>
    </template>
    <v-card-text v-if="edge.richNode.content">
      {{ edge.richNode.content }}
    </v-card-text>
  </v-card>
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

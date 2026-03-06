<template>
  <v-card
    :key="edge.richNode.id"
    :prepend-icon="icon(edge.richNode.type)"
    :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
  >
    <template #title>{{ edge.richNode.name }}</template>
    <template #subtitle>
      <div v-if="edge.type === 'election'" class="d-flex flex-wrap gap-x-2">
        <v-chip v-if="edge.party" size="x-small" density="compact" class="mr-1">
          {{ edge.party }}
        </v-chip>
        <span v-if="edge.position" class="font-weight-bold mr-1">{{
          edge.position
        }}</span>
        <span v-if="edge.term" class="text-caption">({{ edge.term }})</span>
      </div>
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

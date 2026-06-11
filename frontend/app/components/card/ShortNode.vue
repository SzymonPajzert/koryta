<template>
  <v-card
    :key="edge.richNode.id"
    :prepend-icon="getIcon(edge.richNode.type)"
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
import type { EdgeNode } from "~/composables/edges";
import {
  mdiAccountOutline,
  mdiOfficeBuildingOutline,
  mdiFileDocumentOutline,
  mdiCommentArrowRightOutline,
} from "@mdi/js";

function getIcon(type: string) {
  switch (type) {
    case "person":
      return mdiAccountOutline;
    case "place":
      return mdiOfficeBuildingOutline;
    case "article":
      return mdiFileDocumentOutline;
    default:
      return mdiCommentArrowRightOutline;
  }
}

const { edge } = defineProps<{ edge: EdgeNode }>();
</script>

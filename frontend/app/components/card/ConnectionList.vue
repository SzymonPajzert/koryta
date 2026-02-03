<template>
  <div v-if="edges.length > 0" class="mb-4">
    <h3 class="text-h6 mb-2">{{ title }}</h3>
    <v-card>
      <v-list density="compact">
        <v-list-item
          v-for="edge in edges"
          :key="edge.richNode.id"
          :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
          :prepend-icon="nodeTypeIcon[edge.richNode.type]"
        >
          <v-list-item-title>{{ edge.richNode.name }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { nodeTypeIcon } from "~~/shared/model";

const { edges, title } = defineProps<{
  title: string;
  edges: EdgeNode[];
}>();
</script>

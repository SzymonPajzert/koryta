<template>
  <div v-if="edges.length > 0" class="mb-4">
    <h3 class="text-h6 mb-2">{{ title }}</h3>
    <v-card>
      <v-list density="compact">
        <v-list-item
          v-for="edge in edgesSorted"
          :key="edge.richNode.id"
          :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
          :prepend-icon="nodeTypeIcon[edge.richNode.type]"
        >
          <v-list-item-title>
            {{ edge.richNode.name }}
            <span v-if="getPeopleCount(edge) > 0" class="text-medium-emphasis">
              ({{ getPeopleCount(edge) }})
            </span>
          </v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { nodeTypeIcon } from "~~/shared/model";
import type { EdgeNode } from "~~/app/composables/edges";

const { edges, title } = defineProps<{
  title: string;
  edges: EdgeNode[];
}>();

function getPeopleCount(edge: EdgeNode) {
  const stats = edge.richNode.stats as
    | {
        nodeGroupSize?: number;
        people?: number;
      }
    | undefined;
  return stats?.nodeGroupSize ?? stats?.people ?? 0;
}

const edgesSorted = computed(() => {
  return [...edges].sort((a, b) => {
    const countDiff = getPeopleCount(b) - getPeopleCount(a);
    if (countDiff !== 0) return countDiff;
    return (a.richNode.name || "").localeCompare(b.richNode.name || "");
  });
});
</script>

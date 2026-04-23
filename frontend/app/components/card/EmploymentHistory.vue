<template>
  <v-list class="px-2" lines="one" variant="flat">
    <v-list-header>Historia powiązań</v-list-header>

    <div class="pa-3">
      <v-list-item
        v-for="edge in edgesSorted"
        :key="edge.id"
        :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
        base-color="surface-light"
        class="mt-2"
        rounded
      >
        <template #prepend>
          <v-icon :icon="nodeIcon(edge.richNode.type)" />
        </template>

        <template #title>
          <span class="text-subtitle-2 font-weight-bold">{{
            edge.richNode.name
          }}</span>
        </template>

        <template #subtitle>
          <span class="text-caption">{{ edgeLabel(edge) }}</span>
        </template>

        <template #append>
          <ChipRelativeDuration
            :start="edge.start_date"
            :end="edge.end_date"
            :min-start="minStart"
            :max-end="maxEnd"
          />
        </template>
      </v-list-item>
    </div>
  </v-list>
</template>

<script lang="ts" setup>
import { nodeIcon } from "~~/shared/model";

const props = defineProps<{
  edges: EdgeNode[];
}>();

const edgesSorted = computed(() => {
  return props.edges.toSorted((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;

    return b.start_date.localeCompare(a.start_date);
  });
});

const minStart = computed(() => {
  return edgesSorted.value
    .map((e) => e.start_date)
    .filter((d): d is string => !!d)
    .toSorted((a, b) => a?.localeCompare(b))[0];
});

const maxEnd = computed(() => {
  return new Date().toISOString().split("T")[0];
});

function edgeLabel(edge: EdgeNode) {
  return edge.label;
}
</script>

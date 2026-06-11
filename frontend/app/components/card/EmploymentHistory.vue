<template>
  <v-list class="px-2" variant="flat">
    <h3 class="text-h6 mb-2">Historia powiązań</h3>

    <div class="pa-1">
      <v-list-item
        v-for="edge in edgesSorted"
        :key="edge.id"
        :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
        base-color="surface-light"
        class="mt-1"
        rounded
      >
        <template #prepend>
          <v-icon :icon="getIcon(edge.richNode.type)" />
        </template>

        <v-list-item-title class="text-subtitle-2 font-weight-bold text-wrap">
          {{ edge.richNode.name }}
        </v-list-item-title>

        <div class="text-caption text-medium-emphasis text-wrap">
          {{ edgeLabel(edge) }}
        </div>

        <div class="d-md-none mt-2 pb-2">
          <ChipRelativeDuration
            :start="edge.start_date"
            :end="edge.end_date"
            :min-start="minStart"
            :max-end="maxEnd"
          />
        </div>

        <template #append>
          <div class="d-none d-md-flex">
            <ChipRelativeDuration
              :start="edge.start_date"
              :end="edge.end_date"
              :min-start="minStart"
              :max-end="maxEnd"
            />
          </div>
        </template>
      </v-list-item>
    </div>
  </v-list>
</template>

<script lang="ts" setup>
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

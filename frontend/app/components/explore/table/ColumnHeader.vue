<template>
  <div class="d-inline-flex align-center w-100">
    <v-tooltip :text="tooltip" location="top" max-width="300">
      <template #activator="{ props }">
        <v-icon
          :icon="mdiInformationOutline"
          v-bind="props"
          size="small"
          class="mr-2"
          color="grey-darken-1"
          @click.stop
        />
      </template>
    </v-tooltip>
    <span>{{ column.title }}</span>
    <v-icon
      v-if="column.sortable"
      :icon="
        sortBy[0]?.key === column.key
          ? sortBy[0]?.order === 'desc'
            ? mdiArrowDown
            : mdiArrowUp
          : mdiArrowUp
      "
      size="small"
      class="ml-1"
      :class="{ 'opacity-0': sortBy[0]?.key !== column.key }"
    ></v-icon>
  </div>
</template>

<script setup lang="ts">
import { mdiArrowDown, mdiArrowUp, mdiInformationOutline } from "@mdi/js";
defineProps<{
  tooltip: string;
  column: {
    title?: string;
    key: string | null;
    sortable?: boolean;
  };
  sortBy: { key: string; order: "asc" | "desc" }[];
}>();
</script>

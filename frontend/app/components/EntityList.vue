<template>
  <v-data-table
    :headers="headers"
    :items="items"
    :search="search"
    density="compact"
    class="elevation-1"
  >
    <template #top>
      <v-text-field
        v-model="search"
        label="Szukaj"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        hide-details
        single-line
        class="pa-2"
      />
    </template>

    <template #item.actions="{ item }">
      <v-btn
        icon
        variant="text"
        size="small"
        :to="`/edit/node/${item.id}`"
      >
        <v-icon>mdi-pencil</v-icon>
      </v-btn>
    </template>
  </v-data-table>
</template>

<script setup lang="ts">
import type { NodeType } from "~~/shared/model";

const props = defineProps<{
  type: NodeType;
}>();

const { entities } = await useEntity(props.type);

const search = ref("");

const headers = [
  { title: "Nazwa", key: "name" },
  { title: "Akcje", key: "actions", sortable: false, align: "end" as const },
];

const items = computed(() => {
  return Object.entries(entities.value).map(([id, entity]) => ({
    id,
    ...entity,
  }));
});
</script>

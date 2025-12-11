<template :id="`omni-search${fake ? '-fake' : ''}`">
  <v-autocomplete
    v-model="nodeGroupPicked"
    v-model:focused="autocompleteFocus"
    v-model:search="search"
    label="Szukaj osoby albo miejsca"
    :items="items"
    item-title="title"
    return-object
    autocomplete="off"
    class="ma-2"
    bg-color="white"
    :rounded="true"
    :width
    density="comfortable"
    :hide-details="true"
    menu-icon="mdi-magnify"
    clearable
    single-line
    @click:clear="nodeGroupPicked = null"
  >
    <template #item="{ props, item }">
      <v-list-item
        v-bind="props"
        :subtitle="item.raw?.subtitle"
        :title="item.raw.title"
        max-width="400px"
        :prepend-icon="item.raw.icon"
      />
    </template>
    <template #no-data>
      <v-list-item v-if="!search">
        <v-list-item-title> Ładuję dane... </v-list-item-title>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
import { useOmniSearch } from "@/composables/omniSearch";

const props = defineProps<{
  searchText?: string;
  fake?: boolean;
  width?: string;
}>();
const { width = "300px" } = props;

const {
    search,
    nodeGroupPicked,
    autocompleteFocus,
    items
} = useOmniSearch(props);
</script>

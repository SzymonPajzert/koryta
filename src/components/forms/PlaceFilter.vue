<template>
  <v-autocomplete
      label="Filtruj po miejscu zatrudnienia"
      :items="nodeGroups"
      item-title="name"
      v-model="nodeGroupPicked"
      return-object
    >
      <template v-slot:item="{ props, item }">
        <v-list-item
          v-bind="props"
          :subtitle="`${item.raw.stats.people} powiązanych osób`"
          :title="item.raw.name"
        ></v-list-item>
      </template>
    </v-autocomplete>
</template>

<script setup lang="ts">
import { useGraphStore } from "@/stores/graph";
const graphStore = useGraphStore();
const { nodeGroups, nodeGroupPicked } = storeToRefs(graphStore)
</script>

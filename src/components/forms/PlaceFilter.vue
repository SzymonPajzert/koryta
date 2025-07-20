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
          max-width="250px"
        ></v-list-item>
      </template>
    </v-autocomplete>
</template>

<script setup lang="ts">
import { useGraphStore, type NodeGroup } from "@/stores/graph";
import router from '@/router';

const graphStore = useGraphStore();
const { nodeGroups } = storeToRefs(graphStore)

// TODO set here node group picked based on the ID value

const nodeGroupPicked = ref<NodeGroup>()
watch(nodeGroupPicked, (value) => {
  if(value) {
    router.push(`/zobacz/graf/${value.id}`)
  }
})
</script>

<template id="place-filter">
  <v-autocomplete
    v-model="nodeGroupPicked"
    label="Filtruj po miejscu zatrudnienia"
    :items="nodeGroups"
    item-title="name"
    return-object
    autocomplete="off"
  >
    <template #item="{ props, item }">
      <v-list-item
        v-bind="props"
        :subtitle="`${item.raw.stats.people} powiązanych osób`"
        :title="item.raw.name"
        max-width="250px"
      />
    </template>
  </v-autocomplete>
</template>

<script setup lang="ts">
// @ts-expect-error Pinia store definition is complex
import { useGraphStore, type NodeGroup } from "@/stores/graph";
const { push, currentRoute } = useRouter();

const graphStore = useGraphStore();
const { nodeGroups } = storeToRefs(graphStore);

// TODO set here node group picked based on the ID value

const nodeGroupPicked = ref<NodeGroup>();
watch(nodeGroupPicked, (value) => {
  if (!value) return;
  push({
    query: {
      ...currentRoute.value.query,
      miejsce: value.id,
    },
  });
});
</script>

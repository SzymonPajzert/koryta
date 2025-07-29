<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { createEntityStore } from "@/stores/entity";
const useListEntity = createEntityStore("employed");
const entityStore = useListEntity();
const { entities: peopleUnfiltered } = storeToRefs(entityStore);

import { useGraphStore } from "@/stores/graph";
const graphStore = useGraphStore();
const { nodeGroupsMap } = storeToRefs(graphStore);
const route = useRoute<"/zobacz/lista/[[id]]">();

const allowed = computed(() => {
  if (route.params.id) {
    return nodeGroupsMap.value[route.params.id].connected;
  }
  return Object.keys(peopleUnfiltered.value);
});

const people = computed(() => {
  return Object.fromEntries(
    Object.entries(peopleUnfiltered.value).filter((person) =>
      allowed.value.includes(person[0]),
    ),
  );
});
</script>

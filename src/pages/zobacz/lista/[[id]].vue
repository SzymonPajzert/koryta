<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useListEntity } from "@/composables/entity";
const { entities: peopleUnfiltered } = useListEntity("employed");

import { useGraphStore } from "@/stores/graph";
const graphStore = useGraphStore();
const { nodesFiltered } = storeToRefs(graphStore);
const allowed = computed(() => Object.keys(nodesFiltered.value));

const people = computed(() => {
  return Object.fromEntries(
    Object.entries(peopleUnfiltered.value).filter((person) =>
      allowed.value.includes(person[0]),
    ),
  );
});
</script>

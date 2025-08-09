<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
definePageMeta({
  title: "Lista",
});

import { createEntityStore } from "@/stores/entity";
import { useParams } from "@/composables/params";
const useListEntities = createEntityStore("employed");
const entitiesStore = useListEntities();
const { entities: peopleUnfiltered } = storeToRefs(entitiesStore);

const { filtered } = useParams("Lista ");

const people = computed(() => {
  return Object.fromEntries(
    Object.entries(peopleUnfiltered.value).filter((person) =>
      filtered.value.includes(person[0]),
    ),
  );
});
</script>

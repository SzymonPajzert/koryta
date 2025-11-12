<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";

definePageMeta({
  title: "Lista",
});

const { entities: peopleUnfiltered } = await useEntity("person");

const { filterName, filtered } = useParams();
useHead({
  title: computed(() => `Lista ${filterName()}`.trim()),
});

const people = computed(() => {
  return Object.fromEntries(
    Object.entries(peopleUnfiltered.value).filter((person) =>
      filtered.value.includes(person[0]),
    ),
  );
});
</script>

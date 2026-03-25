<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";

definePageMeta({
  title: "Lista",
});

const { filters } = useParams();
const { entities: peopleMaybe } = useEntity("person", filters);

const people = computed(() => {
  const unfiltered = peopleMaybe.value;
  if (!unfiltered) return {};
  return unfiltered;
});
</script>

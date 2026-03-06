<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";

definePageMeta({
  title: "Lista",
});

const { entities: peopleUnfiltered } = await useEntity("person");

const { filtered } = useParams("Lista ");

const people = computed(() => {
  const unfiltered = peopleUnfiltered.value;
  if (!unfiltered) return {};
  return Object.fromEntries(
    Object.entries(unfiltered).filter((person) =>
      filtered.value.includes(person[0]),
    ),
  );
});
</script>

<template>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";

definePageMeta({
  title: "Lista",
});

const { filters } = useParams();
const { entities: peopleMaybe } = useEntities("person", filters);
const { data: articles } = await authFetch("/api/nodes/articles");

const people = computed(() => {
  const unfiltered = peopleMaybe.value;
  if (!unfiltered) return {};

  if (filters.value.source) {
    if (!articles.value) return unfiltered;

    for (const article of articles.value) {
      if (article.domain === filters.value.source) {
        return Object.fromEntries(
          Object.entries(unfiltered).filter(([key]) =>
            article.people.includes(key),
          ),
        );
      }
    }
  }

  console.error("returning");

  return unfiltered;
});
</script>

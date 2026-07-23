<template>
  <v-row v-if="filters.source" class="w-100 mb-2">
    <v-col cols="12" sm="8">
      <div class="d-flex flex-column align-center justify-center h-100">
        <div class="text-h4 font-weight-bold mb-1 w-100 text-center">
          Ludzie wspomnieni w artykułach na stronie
        </div>
      </div>
    </v-col>
    <v-col cols="12" sm="4">
      <HomeSourceCard :source="sourceStats!" />
    </v-col>
  </v-row>
  <ListView :people="people" />
</template>

<script lang="ts" setup>
import { useParams } from "@/composables/params";
import type { SourceStat } from "~~/server/api/nodes/articles/index.get";

definePageMeta({
  title: "Lista",
});

const { filters } = useParams();
const { entities: peopleMaybe } = useEntities("person", filters);
const { data: articles } = await authFetch("/api/nodes/articles");

const sourceStats = computed<SourceStat | undefined>(() => {
  if (!filters.value.source) return;

  return articles.value?.find(
    (article) => article.domain === filters.value.source,
  );
});

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

  return unfiltered;
});
</script>

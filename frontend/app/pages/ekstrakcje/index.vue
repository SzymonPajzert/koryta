<template>
  <v-container>
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-6">
      <h1 class="text-h5 text-sm-h4">Ekstrakcje z artykułów</h1>
      <v-btn
        color="primary"
        variant="tonal"
        :prepend-icon="mdiGestureTapButton"
        to="/ekstrakcje/kategoryzacja"
      >
        Kategoryzuj fakty
      </v-btn>
    </div>

    <div v-if="pending" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <div v-else-if="error" class="py-4">
      <v-alert type="error" variant="tonal">
        Nie udało się załadować ekstrakcji.
      </v-alert>
    </div>

    <div v-else-if="articleGroups.length === 0" class="py-4">
      <v-alert type="info" variant="tonal">
        Brak ekstrakcji do wyświetlenia.
      </v-alert>
    </div>

    <template v-else>
      <ExtractionArticleGroup
        v-for="group in articleGroups"
        :key="group.url"
        :url="group.url"
        :domain="group.domain"
        :facts="group.facts"
      />
    </template>
  </v-container>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiGestureTapButton } from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import type { ExtractionFact } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});
useHead({
  title: "Ekstrakcje z artykułów - koryta.pl",
});

const { data, pending, error } = useExtractions({ groupBy: "article" });

type ArticleGroup = {
  url: string;
  domain: string;
  facts: ExtractionFact[];
};

const articleGroups = computed<ArticleGroup[]>(() => {
  const response = data.value;
  if (!response?.articles) return [];

  return Object.entries(response.articles).map(([url, group]) => ({
    url,
    domain: group.domain,
    facts: group.facts,
  }));
});
</script>

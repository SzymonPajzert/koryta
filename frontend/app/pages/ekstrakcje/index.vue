<template>
  <div class="w-100">
    <AdminPageHead title="Ekstrakcje z artykułów" :lead="lead">
      <template #actions>
        <v-btn
          color="primary"
          variant="tonal"
          :prepend-icon="mdiGestureTapButton"
          to="/ekstrakcje/kategoryzacja"
        >
          Kategoryzuj fakty
        </v-btn>
      </template>
    </AdminPageHead>

    <v-alert
      v-if="articleFilter"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      <div class="d-flex align-center justify-space-between flex-wrap ga-2">
        <span class="text-truncate">
          Fakty z jednego artykułu: <strong>{{ articleFilter }}</strong>
        </span>
        <v-btn size="small" variant="text" to="/ekstrakcje">
          Pokaż wszystkie
        </v-btn>
      </div>
    </v-alert>

    <!-- Also before the first answer: the list is fetched in the browser
         only, so the server render has nothing yet, and "nothing to show" is
         not something the page knows. -->
    <div v-if="pending || (!data && !error)" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <div v-else-if="error">
      <v-alert type="error" variant="tonal">
        Nie udało się załadować ekstrakcji.
      </v-alert>
      <v-btn class="mt-3" variant="tonal" @click="refresh()">
        Spróbuj ponownie
      </v-btn>
    </div>

    <div v-else-if="articleGroups.length === 0">
      <v-alert type="info" variant="tonal">
        {{
          articleFilter
            ? "Z tego artykułu nie zapisano jeszcze żadnych faktów."
            : "Brak ekstrakcji do wyświetlenia."
        }}
      </v-alert>
    </div>

    <!-- One line per article on the quiet rail, as every list that is worked
         through is (.interface-design/system.md): a hundred articles were a
         hundred outlined cards, each holding a card per fact once opened. -->
    <AdminRowList v-else class="k-bleed-xs">
      <ExtractionArticleGroup
        v-for="group in articleGroups"
        :key="group.url"
        :url="group.url"
        :domain="group.domain"
        :facts="group.facts"
      />
    </AdminRowList>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiGestureTapButton } from "@mdi/js";
import { useExtractions } from "~/composables/extractions";
import { polishCountingGrouped } from "~/composables/polish";
import type { ExtractionFact } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});
useHead({
  title: "Ekstrakcje z artykułów - koryta.pl",
});

/** `?article=` narrows the page to one url, which is how `/zrodla` hands a
 * reader the facts a capture just produced.
 *
 * A getter rather than a plain read, so following the link from an already open
 * list refetches instead of showing the previous query's groups.
 */
const route = useRoute();
const articleFilter = computed(() =>
  typeof route.query.article === "string" ? route.query.article : undefined,
);

// This page renders every group at once, so it stays on the newest slice.
const LIMIT = 100;
const { data, pending, error, refresh } = useExtractions({
  groupBy: "article",
  limit: LIMIT,
  articleUrl: articleFilter,
  // In the browser only: a reload rendered on the server, with no token, and
  // hydration kept that answer, so the page said „Brak ekstrakcji” over a
  // backlog of tens of thousands.
  server: false,
});

/** Whether the answer holds the list at all: a count-only answer is what the
 * API gives a caller it cannot see a reader behind, and a count is not a
 * list. */
const listed = computed(() => !!data.value?.articles);

/** How many facts there are and how many of them this is: the list stops at
 * the newest hundred, and nothing on the page used to say so - `total` was in
 * the response and unused. Nothing while there is no count to give, and
 * nothing before the list it describes is in: on a reload the count arrived
 * alone, and the page said „29 156 faktów” right above „Brak ekstrakcji”. */
const lead = computed(() => {
  if (!listed.value) return undefined;
  const total = data.value?.total;
  if (!total) return undefined;
  const facts = polishCountingGrouped(
    total,
    "fakt wyciągnięty",
    "fakty wyciągnięte",
    "faktów wyciągniętych",
  );
  const newest = total > LIMIT ? ` – tu najnowsze ${LIMIT}` : "";
  return articleFilter.value
    ? `${facts} z tego artykułu${newest}.`
    : `${facts} z artykułów${newest}, po jednym wierszu na artykuł.`;
});

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

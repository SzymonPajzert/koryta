<template>
  <v-card v-if="person" class="ma-2" flat>
    <v-card-title class="text-wrap text-h5 mb-2">{{
      person.name
    }}</v-card-title>

    <v-card-text>
      <!-- Quick Add Article button -->
      <div class="mb-6">
        <div class="text-caption text-medium-emphasis mb-2">
          Znalazłaś informacje w internecie i chcesz je dodać na stronę?
        </div>
        <QuickAddArticleButton :node-id="person.id" class="ml-0" />
      </div>

      <!-- Action: Google Search -->
      <div class="mb-6">
        <div class="text-caption text-medium-emphasis mb-2">
          Poszukaj w internecie innych artykułów
        </div>
        <v-btn
          prepend-icon="mdi-google"
          variant="tonal"
          color="primary"
          @click="searchInGoogle()"
        >
          Szukaj w Google
        </v-btn>
      </div>

      <!-- Action: Interesting Vote -->
      <div>
        <VoteWidget
          v-if="person"
          :id="person.id"
          :entity="person"
          type="node"
        />
      </div>
    </v-card-text>
  </v-card>
  <v-card v-else flat class="d-flex align-center justify-center pa-10 h-100">
    <div class="text-medium-emphasis">
      Wybierz osobę z tabeli, aby wyświetlić akcje.
    </div>
  </v-card>
</template>

<script setup lang="ts">
import VoteWidget from "@/components/VoteWidget.vue";
import QuickAddArticleButton from "@/components/QuickAddArticleButton.vue";
import type { PersonRich } from "~~/shared/model";

const { person, region, company } = defineProps<{
  person: undefined | PersonRich;
  region: undefined | [string, string];
  company: undefined | [string, string];
}>();

const getQueryParts = () => {
  const parts = [person?.name];
  if (region) {
    parts.push(region[1]);
  }
  if (company) {
    parts.push(company[1]);
  }
  return parts.filter(Boolean) as string[];
};

const searchInGoogle = () => {
  const parts = getQueryParts();
  const searchQuery = encodeURIComponent(parts.join(" "));
  window.open(`https://www.google.com/search?q=${searchQuery}`, "_blank");
};
</script>

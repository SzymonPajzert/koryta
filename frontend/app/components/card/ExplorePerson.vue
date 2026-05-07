<template>
  <v-card v-if="person" class="ma-2" flat>
    <v-card-title class="text-wrap text-h5 mb-2">{{
      person.name
    }}</v-card-title>

    <v-card-text>
      <!-- Action: Google Search -->
      <div class="mb-6">
        <div class="text-caption text-medium-emphasis mb-2">
          Wyszukaj w internecie informacji:
        </div>
        <v-btn
          v-for="query in queries"
          :key="query"
          prepend-icon="mdi-google"
          variant="tonal"
          color="primary"
          class="ma-1"
          @click="searchInGoogle(query)"
        >
          {{ query }}
        </v-btn>
      </div>

      <!-- Action: Interesting Vote -->
      <div>
        <ButtonVoteWidget
          v-if="person"
          :id="person.id"
          category="interesting"
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
import { computed } from "vue";
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

const uniqueLocations = computed(() => {
  if (!person?.elections) return [];
  const locations = person.elections
    .map((e) => e.location)
    .filter(Boolean) as string[];
  return Array.from(new Set(locations));
});

const queries = computed(() => {
  const result = [];
  if (person?.name) {
    result.push(person.name);
    result.push(person.name + " PKW");

    if (uniqueLocations.value.length > 0) {
      const nameParts = person.name.trim().split(/\s+/);
      let nameWithoutMiddle = person.name;
      if (nameParts.length > 2) {
        nameWithoutMiddle = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;
      }

      for (const loc of uniqueLocations.value) {
        result.push(`${nameWithoutMiddle} ${loc}`);
      }
    }
  }

  return result;
});

const searchInGoogle = (query?: string) => {
  const searchQuery = encodeURIComponent(query || getQueryParts().join(" "));
  window.open(`https://www.google.com/search?q=${searchQuery}`, "_blank");
};
</script>

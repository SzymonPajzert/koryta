<template>
  <v-card v-if="person" class="ma-2" flat>
    <v-card-title class="text-wrap text-h5 mb-2">
      <NuxtLink
        :to="`/osoba/${person.id}`"
        class="text-decoration-none text-primary"
        target="_blank"
      >
        {{ person.name }}
      </NuxtLink>
    </v-card-title>

    <v-card-text>
      <CardPersonInfo :person="person" class="mb-4" />

      <!-- Action: Google Search -->
      <div class="mb-6">
        <div class="text-caption text-medium-emphasis mb-2">
          Wyszukaj w internecie informacji:
        </div>
        <v-btn
          v-for="query in queries"
          :key="query"
          :prepend-icon="mdiGoogle"
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
        <ButtonVoteNumber
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
import { mdiGoogle } from "@mdi/js";
import { toRef } from "vue";
import type { PersonRich } from "~~/shared/model";
import { usePersonSearch } from "~/composables/usePersonSearch";

const props = defineProps<{
  person: undefined | PersonRich;
  region: undefined | [string, string];
  company: undefined | [string, string];
}>();

const { queries, searchInGoogle } = usePersonSearch(
  toRef(props, "person"),
  toRef(props, "region"),
  toRef(props, "company"),
);
</script>

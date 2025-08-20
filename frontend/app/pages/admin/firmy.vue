<template>
  <!-- <v-card>
    TODO Add checkbox - https://vuetifyjs.com/en/components/data-tables/basics/#simple-checkbox
    TODO Znajdź ludzi z takich organizacji jak 0000336643. Nie iteresują mnie, ale algorytm powienien je proponować bo duo ludzi wychodzi z nich.
    TODO List active companies that the person is a part of, filter on them
    TODO Yellow if person is suggested (because in DB) and put on to
    TODO Rodziel punkty jeśli są między radę nadzorczą i zarząd (ale chyba nie jest to warte)
    TODO active only in selected companies, Show only people that are active
    TODO If the KRS is set twice, get two rows and mark them as yellow with a warning
    TODO Make this table server side
  </v-card> -->

  <v-card width="100%">
    <template #text>
      <v-text-field
        v-model="search"
        label="Search"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        hide-details
        single-line
      />
    </template>
    <v-data-table density="compact" :headers="headers" :items="companies" :search="search">
      <!-- eslint fails to pick up the dynamically created slots here -->
      <!-- eslint-disable-next-line vue/v-slot-style vue/valid-v-slot -->
      <template v-slot:item.krsNumber="{ value }">
        <v-chip
          :border="`warning thin opacity-25`"
          color="warning"
          :text="value"
          size="x-small"
          :href=""
        />
      </template>

      <!-- eslint-disable-next-line vue/v-slot-style vue/valid-v-slot -->
      <template v-slot:item.importedFromRejestr="{ value }">
        <v-chip
          :border="`${goodStatus(value)} thin opacity-25`"
          :color="goodStatus(value)"
          :text="value ? 'Tak' : 'Nie'"
          size="x-small"
        />
      </template>
    </v-data-table>
  </v-card>
</template>

<script lang="ts" setup>
import { toNumber, useCompanyScore } from "@/composables/entities/companyScore";
import type { VDataTable } from 'vuetify/components'

const { scores } = useCompanyScore();

const search = ref("");

// TODO add table names
// The fields need to be in Polish, so the table can render them easily
interface CompanyScoredEditable {
  krsNumber: string;
  name: string;
  score: string;
  isPublic: boolean;
  importedFromRejestr: boolean;
}

type ReadonlyHeaders = VDataTable['$props']['headers']
const headers: ReadonlyHeaders = [
  { title: "Nazwa", value: "name" },
  { title: "Wynik", value: "score" },
  { title: "SSP", value: "isPublic" },
  { title: "KRS", value: "krsNumber" },
  { title: "Rejestr.io", value: "importedFromRejestr" },
] as const

const companies = computed(() => {
  const mapped = new Map<string, CompanyScoredEditable>();
  Object.entries(scores.value).forEach(([key, value]) => {
    mapped.set(key, {
      krsNumber: key,
      name: value.name,
      score: toNumber(value.score).toFixed(2),
      isPublic: false, // TODO model it and import it
      importedFromRejestr: !!value.score,
    });
  });

  return Array.from(mapped.values());
})

function goodStatus(value: boolean): string {
  return value ? "success" : "error";
}
</script>

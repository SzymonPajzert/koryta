<template>
  <!--
    TODO Add checkbox - https://vuetifyjs.com/en/components/data-tables/basics/#simple-checkbox
    TODO Always sort the table by the company score

    TODO Allow adding KRS to ingest
      - Znajdź ludzi z takich organizacji jak 0000336643.
      - Nie iteresują mnie, ale algorytm powienien je proponować bo duo ludzi wychodzi z nich.

    TODO If the KRS is set twice, get two rows and mark them as yellow with a warning
    TODO Make this table server side if it's too long
  </v-card> -->

  <v-card width="100%" class="ma-4">
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
    <v-data-table
      density="compact"
      :headers="headers"
      :items="companies"
      :search="search"
    >
      <!-- eslint fails to pick up the dynamically created slots here -->
      <!-- eslint-disable vue/v-slot-style vue/valid-v-slot -->
      <template v-slot:item.krsNumber="{ value, index }">
        <v-text-field
          v-if="editKRSIndex == index"
          v-model="editKRSValue"
          density="compact"
          clearable
          width="160"
          :hide-details="true"
          @keydown.escape="stopEditingKRS"
          @keydown.enter="submitKRSNumber"
        />
        <v-chip
          v-else
          :text="value.value"
          size="x-small"
          @click="editKRS(index, value)"
        />
      </template>

      <template v-slot:item.websiteStatus="{ value, index }">
        <v-chip
          :text="value.internalID ? 'Tak' : 'Nie'"
          size="x-small"
          @click="editKRS(index, value)"
        />
      </template>

      <template v-slot:item.importedFromRejestr="{ value }">
        <v-chip
          :border="`${goodStatus(value.success)} thin opacity-25`"
          :color="goodStatus(value.success)"
          :text="value.success ? 'Tak' : 'Nie'"
          size="x-small"
          :href="value.id ? `https://rejestr.io/krs/${value.krsNumber}` : undefined"
          target="_blank"
        />
      </template>
    </v-data-table>
  </v-card>
</template>

<script lang="ts" setup>
import { toNumber, useCompanyScore } from "@/composables/entities/companyScore";
import type { VDataTable } from 'vuetify/components'

definePageMeta({
  fullWidth: true
})

interface CompanyScoredEditable {
  name: string;
  score: string;
  isPublic: boolean;
  websiteStatus: {
    internalID: string,
  }
  krsNumber: {
    id: string;
    value: string;
  };
  importedFromRejestr: {
    success: boolean
    krsNumber: string
  };
}

const { scores } = useCompanyScore();
const search = ref("");
const editKRSIndex = ref<number | undefined>(undefined);
const editKRSValue = ref("");

function editKRS(index: number, krsNumber: CompanyScoredEditable["krsNumber"]) {
  editKRSIndex.value = index;
  editKRSValue.value = krsNumber.value;
}

function stopEditingKRS() {
  editKRSIndex.value = undefined;
  editKRSValue.value = "";
}
function submitKRSNumber() {
  console.debug(editKRSIndex.value)
  console.debug(editKRSValue.value)
  stopEditingKRS();
}

type ReadonlyHeaders = VDataTable['$props']['headers']
const headers: ReadonlyHeaders = [
  { title: "Nazwa", value: "name", sortable: true, minWidth: "80%"},
  { title: "Wynik", value: "score", sortable: true },
  { title: "Publiczna", value: "isPublic", sortable: true },
  { title: "Na stronie", value: "websiteStatus", sortable: true },
  { title: "KRS", value: "krsNumber", sortable: true },
  { title: "Rejestr.io", value: "importedFromRejestr", sortable: true },
] as const

const companies = computed(() => {
  const mapped = new Map<string, CompanyScoredEditable>();
  Object.entries(scores.value).forEach(([key, value]) => {
    mapped.set(key, {
      krsNumber: {
        id: key,
        value: key,
      },
      name: value.name,
      score: toNumber(value.score).toFixed(2),
      websiteStatus: {
        internalID: undefined,
      },
      isPublic: false, // TODO model it and import it
      importedFromRejestr: {
        success: !!value.score,
        krsNumber: key,
      }
    });
  });

  return Array.from(mapped.values());
})

function goodStatus(value: boolean): string {
  return value ? "success" : "error";
}
</script>

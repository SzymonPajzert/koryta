<template>
  <div class="mb-4">
    <v-row>
      <v-col cols="12" md="3">
        <v-autocomplete
          v-model="party"
          :items="availableParties"
          label="Partia"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
          multiple
          chips
          closable-chips
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-autocomplete
          v-model="teryt"
          :items="availableRegions"
          label="Powiat"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-autocomplete
          v-model="krs"
          :items="availableCompanies"
          label="Spółki"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
          multiple
          chips
          closable-chips
          class="collapsible-autocomplete"
          :class="{ 'is-expanded': showAllKrs }"
        >
          <template v-if="(krs?.length || 0) > 1" #append-inner>
            <v-btn
              variant="tonal"
              size="small"
              color="primary"
              density="compact"
              class="mt-1"
              @click.stop="showAllKrs = !showAllKrs"
            >
              {{ showAllKrs ? "Zwiń" : `+${(krs?.length || 0) - 1}` }}
            </v-btn>
          </template>
        </v-autocomplete>
      </v-col>
      <v-col cols="12" md="3" class="d-flex align-center">
        <v-select
          v-model="currentlyEmployed"
          :items="[
            { title: 'Wszystkie osoby', value: 'all' },
            { title: 'Teraz w dowolnej firmie', value: 'any' },
            { title: 'Teraz w wyszukanych podmiotach', value: 'selected' },
          ]"
          label="Zatrudnienie"
          variant="outlined"
          density="comfortable"
          hide-details
          bg-color="white"
        />
      </v-col>
      <v-col cols="12" md="3">
        <v-select
          v-model="category"
          :items="availableCategories"
          label="Typ podmiotu"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
    </v-row>

    <v-expand-transition>
      <v-sheet
        v-if="showVisibility && showStatusBanner"
        rounded="lg"
        border
        class="pa-4 mt-4 position-relative"
        color="blue-grey-lighten-5"
      >
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          class="position-absolute"
          style="top: 8px; right: 8px"
          color="medium-emphasis"
          @click="showStatusBanner = false"
        ></v-btn>

        <div class="d-flex align-start mb-4 pr-8">
          <v-icon
            color="info"
            class="mr-3 mt-1"
            :icon="mdiInformationOutline"
          ></v-icon>
          <div>
            <div class="text-subtitle-2 font-weight-bold">
              Filtry administracyjne
            </div>
            <div class="text-body-2 text-medium-emphasis">
              Widoczność pozwala na przeglądanie i weryfikację nieopublikowanych
              osób z bazy. Filtr głosów społeczności umożliwia ukrycie
              niezweryfikowanych osób, które zostały już przez kogoś ocenione.
            </div>
          </div>
        </div>

        <v-row>
          <v-col cols="12" sm="6" md="4">
            <v-select
              v-model="visibility"
              :items="[
                { title: 'Wszystkie', value: 'all' },
                { title: 'Opublikowane', value: 'public' },
                { title: 'Szkice', value: 'private' },
              ]"
              label="Widoczność"
              variant="outlined"
              density="comfortable"
              hide-details
              bg-color="white"
            />
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-select
              v-model="hideVoted"
              :items="[
                { title: 'Wszystkie', value: 'all' },
                { title: 'Brak głosu', value: 'no_votes' },
                { title: 'Ocenione', value: 'has_votes' },
              ]"
              label="Głosy społeczności"
              variant="outlined"
              density="comfortable"
              hide-details
              bg-color="white"
            />
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              v-model="minEmploymentDate"
              type="date"
              label="Zatrudnieni od"
              variant="outlined"
              density="comfortable"
              hide-details
              clearable
              bg-color="white"
            />
          </v-col>
          <v-col cols="12" sm="6" md="4">
            <v-text-field
              v-model="minVotes"
              type="number"
              label="Min. głosy łącznie"
              variant="outlined"
              density="comfortable"
              hide-details
              clearable
              :min="0"
              bg-color="white"
            />
          </v-col>
        </v-row>
      </v-sheet>
    </v-expand-transition>

    <div
      v-if="showVisibility && !showStatusBanner"
      class="mt-6 mb-2 d-flex align-center"
    >
      <v-divider></v-divider>
      <v-btn
        variant="tonal"
        size="small"
        class="mx-4 text-none text-caption text-medium-emphasis"
        :prepend-icon="mdiFilterCogOutline"
        @click="showStatusBanner = true"
      >
        {{ statusSummary }}
      </v-btn>
      <v-divider></v-divider>
    </div>
  </div>
</template>

<script setup lang="ts">
import { mdiClose, mdiFilterCogOutline, mdiInformationOutline } from "@mdi/js";
import { ref, computed } from "vue";
import { companyCategories } from "~~/shared/companyCategories";

const showStatusBanner = ref(true);
const showAllKrs = ref(false);

const availableCategories = companyCategories.map((c) => ({
  title: c.title,
  value: c.value,
}));

const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const krs = defineModel<string[] | null>("krs");
const category = defineModel<string | null>("category");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");
const currentlyEmployed = defineModel<"all" | "any" | "selected">(
  "currentlyEmployed",
);
const minEmploymentDate = defineModel<string | null>("minEmploymentDate");
const minVotes = defineModel<number | null>("minVotes");

const statusSummary = computed(() => {
  const filters = [];
  if (visibility.value !== "all") {
    filters.push(visibility.value === "public" ? "opublikowane" : "szkice");
  }
  if (hideVoted.value !== "all") {
    filters.push(hideVoted.value === "no_votes" ? "brak głosu" : "ocenione");
  }

  return `Filtruj po statusie: ${filters.length == 0 ? "wszystkie" : filters.join(", ")}`;
});

withDefaults(
  defineProps<{
    availableParties: { title: string; value: string }[] | string[];
    availableRegions: { title: string; value: string }[];
    availableCompanies: { title: string; value: string }[];
    showVisibility?: boolean;
  }>(),
  {
    showVisibility: true,
  },
);
</script>

<style scoped>
.collapsible-autocomplete:not(.is-expanded)
  :deep(.v-select__selection:nth-of-type(n + 2)),
.collapsible-autocomplete:not(.is-expanded)
  :deep(.v-autocomplete__selection:nth-of-type(n + 2)) {
  display: none !important;
}
</style>

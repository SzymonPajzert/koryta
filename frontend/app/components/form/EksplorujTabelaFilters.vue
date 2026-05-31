<template>
  <div class="mb-4">
    <v-row>
      <v-col cols="12" md="4">
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
      <v-col cols="12" md="4">
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
      <v-col cols="12" md="4">
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
          icon="mdi-close"
          variant="text"
          size="small"
          class="position-absolute"
          style="top: 8px; right: 8px"
          color="medium-emphasis"
          @click="showStatusBanner = false"
        ></v-btn>

        <div class="d-flex align-start mb-4 pr-8">
          <v-icon color="info" class="mr-3 mt-1"
            >mdi-information-outline</v-icon
          >
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
        prepend-icon="mdi-filter-cog-outline"
        @click="showStatusBanner = true"
      >
        {{ statusSummary }}
      </v-btn>
      <v-divider></v-divider>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

const showStatusBanner = ref(true);

const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const krs = defineModel<string[] | null>("krs");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");

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

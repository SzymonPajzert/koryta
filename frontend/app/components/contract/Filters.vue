<template>
  <div class="mb-3">
    <!-- Both halves are always in the DOM and the width picks between them in
         CSS. NEVER a `v-if` on `useDisplay()`: under SSR it reports width 0,
         i.e. `mobile: true` for everybody, so a width branch renders the phone
         half into the html Google indexes and the desktop half never exists at
         all. Measured, not assumed - six source comments in this repo claim a
         „1280px placeholder" that is not what it answers. -->
    <div class="d-md-none d-flex flex-wrap align-center ga-2">
      <v-badge
        :content="changedCount"
        :model-value="changedCount > 0"
        color="ink-info"
      >
        <v-btn
          class="contract-filters__open"
          variant="outlined"
          :prepend-icon="mdiTuneVariant"
          data-testid="umowy-filters"
          @click="sheetOpen = true"
        >
          Filtry
        </v-btn>
      </v-badge>
      <span class="text-caption text-ink-neutral">{{ stateLabel }}</span>
    </div>

    <v-bottom-sheet v-model="sheetOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">Filtry</v-card-title>
        <v-card-text class="d-flex flex-column ga-4">
          <div>
            <p class="text-caption text-ink-neutral mb-1">Kolejność</p>
            <v-btn-toggle
              v-model="sort"
              density="compact"
              variant="outlined"
              mandatory
              data-testid="umowy-sort"
            >
              <v-btn
                v-for="option in sortOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </v-btn>
            </v-btn-toggle>
          </div>
          <div>
            <p class="text-caption text-ink-neutral mb-1">Zakres</p>
            <v-chip-group
              v-model="zakres"
              mandatory
              class="flex-nowrap contract-filters__scope"
              data-testid="umowy-scope"
            >
              <v-chip
                v-for="option in scopeOptions"
                :key="option.value"
                :value="option.value"
                size="small"
                variant="outlined"
              >
                {{ option.label }}
              </v-chip>
            </v-chip-group>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="sheetOpen = false">Gotowe</v-btn>
        </v-card-actions>
      </v-card>
    </v-bottom-sheet>

    <div class="d-none d-md-flex flex-wrap align-center ga-3">
      <v-btn-toggle
        v-model="sort"
        density="compact"
        variant="outlined"
        mandatory
        data-testid="umowy-sort-md"
      >
        <v-btn
          v-for="option in sortOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </v-btn>
      </v-btn-toggle>
      <v-chip-group
        v-model="zakres"
        mandatory
        class="flex-nowrap contract-filters__scope"
        data-testid="umowy-scope-md"
      >
        <v-chip
          v-for="option in scopeOptions"
          :key="option.value"
          :value="option.value"
          size="small"
          variant="outlined"
        >
          {{ option.label }}
        </v-chip>
      </v-chip-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { mdiTuneVariant } from "@mdi/js";
import type { ContractScope, ContractSort } from "~/composables/contracts";

/** The two controls `/eksploruj/umowy` offers, and nothing else.
 *
 * Two parameters, six combinations, six cache entries, one canonical url. There
 * is deliberately no search box - Firestore cannot do substring matching over
 * `przedmiot_umowy` and a second search store is a bigger decision than this
 * feature - no value slider, no województwo select and no date picker: the
 * register window is six weeks wide, so a date filter would be a control over
 * almost nothing.
 *
 * The testids are asymmetric on purpose. The phone half carries the plain
 * `umowy-sort` / `umowy-scope` because that is the half the e2e drives at
 * 375x667; the desktop copy is suffixed `-md`, so a `getByTestId` never matches
 * two elements and fails on strictness rather than on the feature.
 */
const sort = defineModel<ContractSort>("sort", { default: "data" });
const zakres = defineModel<ContractScope>("zakres", { default: "wszystkie" });

const sheetOpen = ref(false);

const sortOptions: { value: ContractSort; label: string }[] = [
  { value: "data", label: "Najnowsze" },
  { value: "kwota", label: "Największe kwoty" },
];

const scopeOptions: { value: ContractScope; label: string }[] = [
  { value: "wszystkie", label: "Wszystkie" },
  { value: "nasze", label: "Nasze instytucje" },
  { value: "obie", label: "Obie strony" },
];

/** How many of the two are set to something other than their default - what the
 * badge on the closed „Filtry" button counts. Without it the phone reader has
 * no way to tell a filtered list from the whole register. */
const changedCount = computed(
  () =>
    (sort.value === "data" ? 0 : 1) + (zakres.value === "wszystkie" ? 0 : 1),
);

/** The current state, spelled out beside the button. „Najnowsze · wszystkie
 * umowy" - the same information the badge counts, in the words the sheet uses,
 * so opening it holds no surprise. */
const stateLabel = computed(() => {
  const sortLabel =
    sortOptions.find((o) => o.value === sort.value)?.label ?? "";
  const scopeLabel =
    zakres.value === "wszystkie"
      ? "wszystkie umowy"
      : (scopeOptions
          .find((o) => o.value === zakres.value)
          ?.label.toLocaleLowerCase("pl-PL") ?? "");
  return `${sortLabel} · ${scopeLabel}`;
});
</script>

<style scoped>
/* 44px on a phone, the minimum tap target. Vuetify's default button is 36px at
   this density. */
.contract-filters__open {
  min-height: 44px;
}

/* Three chips are wider than 375px with the labels this site uses, and
   `flex-nowrap` alone would clip the third rather than let it be reached. */
.contract-filters__scope {
  overflow-x: auto;
}
</style>

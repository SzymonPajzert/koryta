<template>
  <div class="link-filters" data-testid="powiazania-filtry">
    <!-- No `v-if` on the display width: under SSR `useDisplay()` reports a
         phone for everybody (see `contract/Filters.vue`). The controls wrap
         instead, which is the same markup at every width. -->
    <!-- `role="group"`, a name and `aria-pressed` by hand on all three: Vuetify
         marks the chosen button with a class and nothing else, so a screen
         reader could not tell which order, status or class was on - and on
         the class toggle, whether pressing a letter would set it or clear
         it. -->
    <v-btn-toggle
      v-model="sort"
      density="compact"
      variant="outlined"
      mandatory
      divided
      role="group"
      aria-label="Kolejność"
      data-testid="powiazania-kolejnosc"
    >
      <v-btn value="sila" :aria-pressed="String(sort === 'sila')">
        Najmocniejsze
      </v-btn>
      <v-btn value="kwota" :aria-pressed="String(sort === 'kwota')">
        Największe kwoty
      </v-btn>
    </v-btn-toggle>

    <v-btn-toggle
      v-model="status"
      density="compact"
      variant="outlined"
      mandatory
      divided
      role="group"
      aria-label="Stan sprawdzenia"
      data-testid="powiazania-status"
    >
      <v-btn value="wszystkie" :aria-pressed="String(status === 'wszystkie')">
        Wszystkie
      </v-btn>
      <v-btn value="sprawdzone" :aria-pressed="String(status === 'sprawdzone')">
        Sprawdzone
      </v-btn>
    </v-btn-toggle>

    <!-- Not mandatory: pressing the chosen letter again clears it. Its own
         control rather than a fifth sort, because „Największe kwoty" alone is
         led by weak D links, and the reader looking for the biggest strong
         finding needs the two together. -->
    <v-btn-toggle
      v-model="klasa"
      density="compact"
      variant="outlined"
      divided
      role="group"
      aria-label="Klasa powiązania"
      data-testid="powiazania-klasa"
    >
      <v-btn
        v-for="letter in contractLinkStrengths"
        :key="letter"
        :value="letter"
        :aria-label="`Klasa ${letter}: ${CONTRACT_LINK_STRENGTH_LABELS[letter].short}`"
        :aria-pressed="String(klasa === letter)"
        class="link-filters__class"
      >
        {{ letter }}
        <v-tooltip activator="parent" location="bottom" max-width="320">
          <strong
            >{{ letter }} ·
            {{ CONTRACT_LINK_STRENGTH_LABELS[letter].short }}.</strong
          >
          {{ CONTRACT_LINK_STRENGTH_LABELS[letter].long }}
        </v-tooltip>
      </v-btn>
    </v-btn-toggle>

    <!-- „płatnika", because that is what it is: the region of the institution
         that paid the most, which for a councillor paid by a neighbouring
         region is not where they sit. -->
    <v-select
      v-model="woj"
      :items="items"
      item-title="title"
      item-value="value"
      label="Województwo płatnika"
      density="compact"
      variant="outlined"
      hide-details
      clearable
      class="link-filters__woj"
      data-testid="powiazania-woj"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  ContractLinkSort,
  ContractLinkStatusFilter,
} from "~/composables/contractLinks";
import {
  CONTRACT_LINK_STRENGTH_LABELS,
  contractLinkStrengths,
  type ContractLinkClassFilter,
} from "~~/shared/contractLinks";

const sort = defineModel<ContractLinkSort>("sort", { required: true });
const status = defineModel<ContractLinkStatusFilter>("status", {
  required: true,
});
const klasa = defineModel<ContractLinkClassFilter | null>("klasa", {
  required: true,
});
const woj = defineModel<string | null>("woj", { required: true });

const { wojewodztwa, showCounts = true } = defineProps<{
  wojewodztwa: { name: string; links: number }[];
  /** The counts are for every finding in the region. Beside a status or class
   * filter they would promise 44 and show 18, so the page turns them off. */
  showCounts?: boolean;
}>();

const items = computed(() =>
  wojewodztwa.map((entry) => ({
    title: showCounts ? `${entry.name} (${entry.links})` : entry.name,
    value: entry.name,
  })),
);
</script>

<style scoped>
.link-filters {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.link-filters__woj {
  flex: 0 1 240px;
  min-width: 200px;
}

.link-filters__class {
  font-weight: 700;
  min-width: 40px;
}

/* A thumb, not a cursor: 36px toggles were the most mis-tapped controls on a
   phone. A media query rather than `density`, which would need `useDisplay()`
   and so the phone branch for everybody under SSR. */
@media (max-width: 599.98px) {
  .link-filters :deep(.v-btn-group) {
    height: 44px;
  }

  /* „NAJMOCNIEJSZE | NAJWIĘKSZE KWOTY" is 26px wider than a 360px phone
     at the default padding and tracking. */
  .link-filters :deep(.v-btn-group .v-btn) {
    letter-spacing: normal;
    padding-inline: 10px;
  }

  .link-filters__class {
    min-width: 44px;
  }
}
</style>

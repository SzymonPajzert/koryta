<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn :icon="mdiArrowLeft" variant="text" class="mr-2" to="/admin" />
      <div>
        <h1 class="text-h4">Wyszukiwania</h1>
        <div class="text-caption text-medium-emphasis">
          Czego czytelnicy szukali w wyszukiwarce na górze strony - jedno
          wyszukiwanie to ostatnie zapytanie, zanim ktoś otworzył wynik albo
          zrezygnował. Bez danych o tym, kto szukał. Wpisy znikają po
          {{ RETENTION_DAYS }} dniach.
        </div>
      </div>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
    />

    <!-- The window and whose searches: they scope the chart and the list
         under it alike, so they come first, above both. -->
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-btn-toggle
        v-model="days"
        mandatory
        density="compact"
        variant="outlined"
        divided
        data-testid="searches-days"
      >
        <v-btn
          v-for="option in DAY_OPTIONS"
          :key="option"
          :value="option"
          size="small"
        >
          {{ option }} dni
        </v-btn>
      </v-btn-toggle>
      <v-switch
        v-model="signedOutOnly"
        label="Tylko niezalogowani"
        density="compact"
        hide-details
        color="primary"
      />
      <v-spacer />
      <div v-if="summary" class="text-caption text-medium-emphasis">
        {{
          polishCounting(
            summary.total,
            "wyszukiwanie",
            "wyszukiwania",
            "wyszukiwań",
          )
        }}, w tym {{ summary.signedOut }} przez niezalogowanych
        <span v-if="summary.truncated"> · liczone tylko najnowsze</span>
      </div>
    </div>

    <!-- Not after a failed first load: the alert above says why, and an
         empty card would say nobody searched. -->
    <AdminSearchEndings
      v-if="summary || !error"
      class="mb-6"
      :daily="summary?.daily"
      :signed-out-only="signedOutOnly"
      :loading="pending"
    />

    <!-- Which queries the list shows. A view of the list alone: the chart
         above counts every search of the window, whichever is picked. -->
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <v-chip-group v-model="view" mandatory>
        <v-chip value="all" filter>Wszystkie</v-chip>
        <v-chip value="none" filter data-testid="searches-view-none">
          Bez wyników
        </v-chip>
        <v-chip value="unverified" filter>Tylko niezweryfikowane</v-chip>
      </v-chip-group>
      <v-spacer />
      <div
        v-if="rows.length > shownRows.length"
        class="text-caption text-medium-emphasis"
      >
        {{ shownRows.length }} najczęstszych z {{ rows.length }} zapytań
      </div>
    </div>

    <v-data-table
      density="compact"
      item-value="query"
      :headers="headers"
      :items="shownRows"
      :loading="pending"
      no-data-text="Nikt jeszcze niczego takiego nie szukał."
      loading-text="Ładowanie..."
      :items-per-page="-1"
      hide-default-footer
      data-testid="searches-table"
    >
      <template #[`item.lastAt`]="{ item }">
        <span class="text-caption">{{
          shortDate(item.lastAt.slice(0, 10))
        }}</span>
      </template>
    </v-data-table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiArrowLeft } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import { shortDate } from "~~/shared/dates";
import { RETENTION_DAYS } from "~~/shared/searchLog";
import type { SearchesSummary } from "~~/server/api/admin/searches.get";

/** What readers searched for - the site's own copy of the queries, beside
 * what Plausible gets (`shared/searchLog.ts`). The owner's alone, like the task
 * list: the queries are names. The two lists worth reading are the
 * searches that found nothing - people the site does not have - and the ones
 * that found only unpublished people, whom a logged out reader gets a teaser
 * of: the review queue, ordered by who is being looked for. */
definePageMeta({
  middleware: "owner",
  fullWidth: true,
});

useHead({
  title: "Wyszukiwania (Admin) - koryta.pl",
});

const DAY_OPTIONS = [7, 30, 90, RETENTION_DAYS] as const;

const headers = [
  { title: "Zapytanie", key: "query" },
  { title: "Wyszukań", key: "count", align: "end" as const },
  { title: "Niezalogowani", key: "signedOut", align: "end" as const },
  { title: "Bez wyników", key: "noResults", align: "end" as const },
  {
    title: "Tylko niezweryfikowane",
    key: "onlyUnverified",
    align: "end" as const,
  },
  { title: "Otwarto wynik", key: "picks", align: "end" as const },
  { title: "Ostatnio", key: "lastAt", width: 120 },
];

const days = ref<number>(30);
const view = ref<"all" | "none" | "unverified">("all");
const signedOutOnly = ref(false);
const summary = ref<SearchesSummary | null>(null);
const pending = ref(false);
const error = ref<string | null>(null);

const rows = computed(() =>
  (summary.value?.queries ?? []).filter(
    (row) =>
      (!signedOutOnly.value || row.signedOut > 0) &&
      (view.value !== "none" || row.noResults > 0) &&
      (view.value !== "unverified" || row.onlyUnverified > 0),
  ),
);

/** The most rows drawn at once. One page, without the table's own pager -
 * which speaks English - and the rarest queries are the least worth reading. */
const MAX_ROWS = 300;
const shownRows = computed(() => rows.value.slice(0, MAX_ROWS));

async function load() {
  // Only the owner's token gets an answer, and the server render has none.
  if (import.meta.server) return;
  pending.value = true;
  error.value = null;
  try {
    summary.value = await authRequest<SearchesSummary>("/api/admin/searches", {
      method: "GET",
      query: { days: days.value },
    });
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się wczytać wyszukiwań.";
  } finally {
    pending.value = false;
  }
}

watch(days, () => load());
onMounted(() => load());
</script>

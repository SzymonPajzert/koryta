<template>
  <div class="w-100">
    <!-- The admin pages' head: the way back as a named link above the title,
         one sentence under it and the method behind the (i). The page had a
         head of its own: a bare arrow beside the title, which pushed the h1
         off the page's edge, over three sentences of 12px, on a page of its
         own width and padding. -->
    <AdminPageHead
      title="Wyszukiwania"
      lead="Czego czytelnicy szukali w wyszukiwarce na górze strony."
    >
      <template #back>
        <v-btn
          variant="text"
          size="small"
          :prepend-icon="mdiArrowLeft"
          to="/admin"
        >
          Panel administracyjny
        </v-btn>
      </template>
      <template #info>
        Jedno wyszukiwanie to ostatnie zapytanie, zanim ktoś otworzył wynik albo
        zrezygnował. Bez danych o tym, kto szukał. Wpisy znikają po
        {{ RETENTION_DAYS }} dniach.
      </template>
    </AdminPageHead>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
    />

    <!-- A row of controls, not a record, so no card round it. The window is
         the site's neutral segmented toggle, as on /eksploruj/statystyki. The
         views are the row of chips /admin/opinie and /qa pick theirs from,
         sage when on: Vuetify's grey chips with a tick slid sideways on a
         phone, cutting the last one in half, where these wrap. A view's chip
         is `[data-filter="none"]` and so on, inside `searches-view`. -->
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <SegmentedToggle v-model="days" data-testid="searches-days">
        <v-btn
          v-for="option in DAY_OPTIONS"
          :key="option"
          :value="option"
          size="small"
        >
          {{ option }} dni
        </v-btn>
      </SegmentedToggle>
      <FeedbackFilterChips
        v-model="view"
        :options="VIEW_OPTIONS"
        data-testid="searches-view"
      />
      <!-- On or off over whichever view is on, so a box to tick rather than
           one more view, drawn as /aktywnosc draws „Ukryj moje zmiany”: quiet
           either way, the box saying which. It was a switch, whose 16px label
           stood out of a row of 14px chips. -->
      <v-chip
        variant="outlined"
        class="filter-chip"
        :prepend-icon="
          signedOutOnly ? mdiCheckboxMarked : mdiCheckboxBlankOutline
        "
        role="checkbox"
        :aria-checked="signedOutOnly"
        data-testid="searches-signed-out"
        @click="signedOutOnly = !signedOutOnly"
      >
        Tylko niezalogowani
      </v-chip>
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
        <span v-if="rows.length > shownRows.length">
          · {{ shownRows.length }} najczęstszych z {{ rows.length }} zapytań
        </span>
      </div>
    </div>

    <!-- Edge to edge on a phone, as the admin pages' other lists. The bleed
         sits on a plain wrapper: on the table itself Vuetify's
         `.v-table { max-width: 100% }` holds it at the column's width. -->
    <div class="k-bleed-xs">
      <v-data-table
        density="compact"
        item-value="query"
        :headers="headers"
        :items="shownRows"
        :loading="pending"
        :hide-default-body="shownRows.length === 0"
        :items-per-page="-1"
        hide-default-footer
        data-testid="searches-table"
      >
        <template #[`item.lastAt`]="{ item }">
          <span class="text-caption">{{
            shortDate(item.lastAt.slice(0, 10))
          }}</span>
        </template>
        <!-- With no rows, loading or none to show, the sentence goes under
             the head and outside the part that scrolls, from the start edge.
             As the table's own row it was centred on the table's whole width,
             which a phone scrolls sideways: „Nikt jeszcze niczeg”, cut at
             the screen's edge. -->
        <template #bottom>
          <p v-if="shownRows.length === 0" class="px-4 py-2">
            {{
              pending
                ? "Ładowanie..."
                : "Nikt jeszcze niczego takiego nie szukał."
            }}
          </p>
        </template>
      </v-data-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  mdiArrowLeft,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
} from "@mdi/js";
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

type View = "all" | "none" | "unverified";

const VIEW_OPTIONS: { value: View; title: string }[] = [
  { value: "all", title: "Wszystkie" },
  { value: "none", title: "Bez wyników" },
  { value: "unverified", title: "Tylko niezweryfikowane" },
];

const days = ref<number>(30);
const view = ref<View>("all");
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

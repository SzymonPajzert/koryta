<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-2">
      <h1 class="text-h5 text-sm-h4">Administracja - Rewizje krawędzi</h1>
      <v-btn
        :icon="mdiRefresh"
        variant="text"
        size="small"
        :loading="pending"
        @click="fetchData"
      />
    </div>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Zmiany krawędzi zaproponowane przez pipeline, których nikt jeszcze nie
      rozpatrzył. Pipeline zapisuje zmianę od razu tylko wtedy, gdy potrafi za
      nią ręczyć - komitet wyborczy z listy przypisanej do partii. Reszta czeka
      tutaj, a sama krawędź pozostaje nietknięta.
    </p>

    <v-card class="mb-4 pa-3">
      <v-select
        v-model="filterType"
        :items="typeOptions"
        label="Typ krawędzi"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 20rem"
      />
    </v-card>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
    />

    <!-- The queue links here naming one proposal, and this list only holds the
         pending ones of one type at a time. Saying nothing when the named one
         is not here would leave the reviewer scanning forty rows for a
         highlight that cannot appear - so say it, and hand back the one screen
         that answers for any proposal whatever its status. -->
    <v-alert
      v-if="missingHighlight"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      data-testid="highlight-missing"
    >
      <div class="d-flex align-center flex-wrap ga-2">
        <span>
          Propozycji z linku nie ma na tej liście - albo została już
          rozpatrzona, albo ukrywa ją filtr typu, albo jest na dalszej stronie.
        </span>
        <v-btn
          variant="text"
          size="small"
          data-testid="highlight-in-queue"
          :to="`/admin/rewizje/kolejka?rewizja=${highlighted}`"
        >
          Pokaż w kolejce
        </v-btn>
      </div>
    </v-alert>

    <v-card>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        class="edge-revision-table"
        :headers="headers"
        :items="items"
        :items-length="totalItems"
        :loading="pending"
        :items-per-page-options="[10, 25, 50, 100]"
        :row-props="rowProps"
        no-data-text="Nic nie czeka na rozpatrzenie."
        @update:options="fetchData"
      >
        <template #[`item.edge`]="{ item }">
          <div class="d-flex align-center flex-wrap ga-1 py-1">
            <NuxtLink v-if="item.source.type" :to="entityPath(item.source)">
              {{ item.source.name || item.source.id }}
            </NuxtLink>
            <span v-else class="text-medium-emphasis">{{
              item.source.id
            }}</span>
            <v-icon :icon="mdiArrowRight" size="x-small" class="mx-1" />
            <NuxtLink v-if="item.target.type" :to="entityPath(item.target)">
              {{ item.target.name || item.target.id }}
            </NuxtLink>
            <span v-else class="text-medium-emphasis">{{
              item.target.id
            }}</span>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ item.edgeType }}
            <span v-if="!item.published"> · niezatwierdzona</span>
          </div>
        </template>

        <template #[`item.changes`]="{ item }">
          <div class="py-2 d-flex flex-column ga-1">
            <div
              v-for="change in item.changes"
              :key="change.field"
              class="text-caption"
            >
              <span class="font-weight-bold">{{ change.field }}</span>
              <span v-if="change.from !== null" class="text-medium-emphasis">
                {{ " " }}{{ display(change.from) }} →
              </span>
              <span v-else class="text-medium-emphasis">{{ " " }}+</span>
              {{ " " }}{{ display(change.to) }}
            </div>
            <span v-if="!item.changes.length" class="text-medium-emphasis">
              Krawędź już to zawiera.
            </span>
          </div>
        </template>

        <template #[`item.updateTime`]="{ item }">
          <div>{{ formatDate(item.updateTime) }}</div>
          <div class="text-caption text-medium-emphasis">
            {{ item.automatic ? "pipeline" : item.updateUser }}
          </div>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { mdiArrowRight, mdiRefresh } from "@mdi/js";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { useRoute } from "vue-router";
import { useQueryFilters } from "~/composables/queryFilters";
import type {
  PendingEdgeEndpoint,
  PendingEdgeRevision,
} from "~~/server/api/revisions/pendingEdges.get";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({ title: "Rewizje krawędzi (Admin) - koryta.pl" });

const user = useCurrentUser();
const isAuthReady = useIsCurrentUserLoaded();
const route = useRoute();
const { setQuery, stringFilter } = useQueryFilters();

/** The proposal the review queue linked to, if it linked to one. Read only:
 * nothing on this page sets it, it survives paging and filtering because
 * `setQuery` in `fetchData` only ever touches the keys it names, and it is
 * dropped simply by arriving here from the menu instead. */
const highlighted = stringFilter("rewizja");

const DEFAULT_ITEMS_PER_PAGE = 25;

const itemsPerPage = ref(
  parseInt(
    (route.query.itemsPerPage as string) || String(DEFAULT_ITEMS_PER_PAGE),
  ),
);
const page = ref(parseInt((route.query.page as string) || "1"));
const filterType = ref<string | null>((route.query.type as string) || null);

// Every edge type the ingest can propose a change to. Only `election` produces
// any today; the rest are here so a later one does not need a code change to
// become filterable.
const typeOptions = [
  { title: "Kandydatura", value: "election" },
  { title: "Zatrudnienie", value: "employed" },
  { title: "Własność", value: "owns" },
  { title: "Siedziba", value: "seat" },
  { title: "Powiązanie", value: "connection" },
];

const headers = [
  { title: "Krawędź", key: "edge", sortable: false },
  { title: "Proponowana zmiana", key: "changes", sortable: false },
  { title: "Zgłoszono", key: "updateTime", sortable: false },
];

const items = ref<PendingEdgeRevision[]>([]);
const totalItems = ref(0);
const pending = ref(false);
const error = ref<string | null>(null);
/** Whether a fetch has ever come back. `pending` cannot stand in for it: the
 * table only asks for the first page once it has mounted, so between render and
 * that request the page is idle with an empty list. */
const loaded = ref(false);

function entityPath(endpoint: PendingEdgeEndpoint) {
  return `/entity/${endpoint.type}/${endpoint.id}`;
}

/** Marks the row the queue linked to. Through `row-props` rather than a class
 * inside a cell slot: the tint belongs to the whole `tr`, and the `tr` is
 * Vuetify's to render, not this template's. */
const rowProps = ({ item }: { item: PendingEdgeRevision }) => ({
  "data-revision-row": item.id,
  class: item.id === highlighted.value ? "highlighted-revision" : undefined,
});

/** A tint on a row below the fold is not a highlight - the same reasoning the
 * comparison view gives for scrolling to the column it tints. Waits for the
 * rows to exist (`nextTick` after the fetch has written `items`), and centres
 * rather than nudges, so the neighbours it sits between come with it. */
const scrollToHighlighted = async () => {
  // The server render has no scroll position to fix, and no `document`.
  if (import.meta.server) return;
  const id = highlighted.value;
  if (!id) return;
  await nextTick();
  // Scanned rather than interpolated into a selector: `rewizja` arrives from
  // the url, and a value carrying a quote makes `querySelector` throw a
  // SyntaxError - here, inside a watcher, which surfaces as an unhandled
  // rejection rather than as a missing highlight. A page holds a hundred rows
  // at most, so the scan costs nothing worth naming.
  const row = Array.from(document.querySelectorAll("[data-revision-row]")).find(
    (element) => element.getAttribute("data-revision-row") === id,
  );
  row?.scrollIntoView({ block: "center" });
};

watch(
  () => [items.value.length, highlighted.value] as const,
  scrollToHighlighted,
  { immediate: true },
);

/** The link named a proposal this list does not contain. Only claimed once a
 * fetch has actually landed - before that, and while one is in flight, and
 * after one failed, the list is empty for reasons that have nothing to do with
 * the link, and the error alert above already speaks for the last of them. */
const missingHighlight = computed(
  () =>
    !!highlighted.value &&
    loaded.value &&
    !pending.value &&
    !error.value &&
    !items.value.some((row) => row.id === highlighted.value),
);

/** A field value as one short line. The values are the scalars an edge carries
 * - a committee, a party, a date - so this is mostly about not printing
 * `[object Object]` if one ever is not. */
function display(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pl-PL");
}

const authHeaders = computed(() => user.value);

async function fetchData() {
  pending.value = true;
  error.value = null;
  try {
    if (!isAuthReady.value) {
      await new Promise<void>((resolve) => {
        const unwatch = watch(
          isAuthReady,
          (ready) => {
            if (ready) {
              unwatch();
              resolve();
            }
          },
          { immediate: true },
        );
      });
    }

    // authFetch only attaches a token to writes, and this is a GET behind an
    // admin claim, so the header goes on by hand - the same way /admin/rewizje
    // does it.
    const headersInit: HeadersInit = {};
    if (authHeaders.value) {
      headersInit["Authorization"] =
        `Bearer ${await authHeaders.value.getIdToken()}`;
    }

    const res = await $fetch<{
      revisions: PendingEdgeRevision[];
      total: number;
    }>("/api/revisions/pendingEdges", {
      params: {
        page: page.value,
        limit: itemsPerPage.value,
        type: filterType.value || undefined,
      },
      headers: headersInit,
    });

    items.value = res.revisions;
    totalItems.value = res.total;

    setQuery({
      page: page.value > 1 ? String(page.value) : undefined,
      itemsPerPage:
        itemsPerPage.value === DEFAULT_ITEMS_PER_PAGE
          ? undefined
          : String(itemsPerPage.value),
      type: filterType.value || undefined,
    });
  } catch (err) {
    console.error(err);
    error.value = "Nie udało się wczytać rewizji krawędzi.";
  } finally {
    pending.value = false;
    loaded.value = true;
  }
}

watch(filterType, () => {
  page.value = 1;
  fetchData();
});
</script>

<style scoped>
/* The `tr` is rendered by VDataTableRows, several components below this
   template, so this file's scope id never reaches it and a bare
   `.highlighted-revision` rule here would match nothing at all. `:deep()` off a
   class that does land on the table is the way through. The tint is the same
   one /admin/rewizje/[id] uses on the column it was linked to, on purpose: it
   is the same "this is the one you clicked". */
.edge-revision-table :deep(tr.highlighted-revision) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
}
</style>

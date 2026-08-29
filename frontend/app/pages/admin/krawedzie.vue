<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn :icon="mdiArrowLeft" variant="text" class="mr-2" to="/admin" />
      <div>
        <h1 class="text-h4">Powiązania do opublikowania</h1>
        <div class="text-caption text-grey-darken-1">
          Nieopublikowane powiązania, których obie strony są już opublikowane -
          czyli te, które można pokazać publicznie od razu.
        </div>
      </div>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
      data-testid="edges-queue-error"
    />

    <v-card class="mb-4 pa-3">
      <div class="d-flex align-center flex-wrap ga-3">
        <v-btn
          color="success"
          variant="tonal"
          :disabled="selected.length === 0"
          :loading="publishing"
          :prepend-icon="mdiEarth"
          data-testid="edges-publish-selected"
          @click="publishSelected()"
        >
          Opublikuj zaznaczone ({{ selected.length }})
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          :disabled="rows.length === 0"
          data-testid="edges-select-all"
          @click="toggleAll"
        >
          {{ allSelected ? "Odznacz wszystkie" : "Zaznacz wszystkie" }}
        </v-btn>
        <v-spacer />
        <div class="text-caption text-grey-darken-1">
          Przejrzano {{ scanned }} powiązań
          <span v-if="truncated">
            · przerwano na limicie, użyj "Wczytaj więcej"</span
          >
        </div>
      </div>
    </v-card>

    <v-data-table
      v-model="selected"
      density="compact"
      show-select
      item-value="id"
      :headers="headers"
      :items="rows"
      :loading="pending"
      no-data-text="Nie ma powiązań gotowych do publikacji."
      loading-text="Ładowanie..."
      items-per-page="-1"
      data-testid="edges-queue-table"
    >
      <template #[`item.relation`]="{ item }">
        <span class="font-weight-medium">{{ label(item) }}</span>
      </template>
      <template #[`item.source`]="{ item }">
        <nuxt-link
          :to="`/admin/rewizje/${item.sourceId}`"
          class="text-decoration-none text-primary"
        >
          {{ item.sourceName || item.sourceId }}
        </nuxt-link>
      </template>
      <template #[`item.target`]="{ item }">
        <nuxt-link
          :to="`/admin/rewizje/${item.targetId}`"
          class="text-decoration-none text-primary"
        >
          {{ item.targetName || item.targetId }}
        </nuxt-link>
      </template>
      <template #[`item.dates`]="{ item }">
        <span class="text-caption">
          {{
            [item.start_date, item.end_date].filter(Boolean).join(" - ") || "-"
          }}</span
        >
      </template>
      <template #bottom>
        <div class="d-flex justify-center pa-3">
          <v-btn
            v-if="nextCursor"
            variant="text"
            :loading="pending"
            data-testid="edges-load-more"
            @click="load(true)"
          >
            Wczytaj więcej
          </v-btn>
        </div>
      </template>
    </v-data-table>

    <v-snackbar v-model="noticeShown" color="info" :timeout="6000">
      {{ notice }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiArrowLeft, mdiEarth } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { relationsPlural } from "~/composables/edges";
import { edgeTypeLabels } from "~~/shared/edges";
import type {
  UnpublishedEdgeRow,
  UnpublishedEdges,
} from "~~/server/api/edges/unpublished.get";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({
  title: "Powiązania do opublikowania (Admin) - koryta.pl",
});

const headers = [
  { title: "Powiązanie", key: "relation", sortable: false },
  { title: "Od", key: "source", sortable: false },
  { title: "Do", key: "target", sortable: false },
  { title: "Okres", key: "dates", sortable: false, width: 180 },
];

const rows = ref<UnpublishedEdgeRow[]>([]);
const selected = ref<string[]>([]);
const nextCursor = ref<string | null>(null);
const scanned = ref(0);
const truncated = ref(false);
const pending = ref(false);
const publishing = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const noticeShown = ref(false);

const allSelected = computed(
  () => rows.value.length > 0 && selected.value.length === rows.value.length,
);

function label(row: UnpublishedEdgeRow): string {
  return row.name || edgeTypeLabels[row.type] || row.type;
}

function toggleAll() {
  selected.value = allSelected.value ? [] : rows.value.map((row) => row.id);
}

/** @param more whether to append the next page rather than start over. */
async function load(more = false) {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  pending.value = true;
  error.value = null;
  try {
    const data = await authRequest<UnpublishedEdges>("/api/edges/unpublished", {
      method: "GET",
      query: {
        limit: 50,
        ...(more && nextCursor.value ? { cursor: nextCursor.value } : {}),
      },
    });
    rows.value = more ? [...rows.value, ...data.edges] : data.edges;
    if (!more) selected.value = [];
    nextCursor.value = data.nextCursor;
    scanned.value = more ? scanned.value + data.scanned : data.scanned;
    truncated.value = data.truncated;
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się wczytać powiązań.";
  } finally {
    pending.value = false;
  }
}

async function publishSelected() {
  const ids = [...selected.value];
  if (ids.length === 0) return;

  publishing.value = true;
  error.value = null;
  try {
    // The server caps a request at one batch, so a long selection is sent in
    // the same chunks it will be committed in.
    for (let i = 0; i < ids.length; i += 100) {
      await authRequest("/api/edges/publish", {
        body: { edge_ids: ids.slice(i, i + 100), published: true },
      });
    }
    notice.value = `Opublikowano ${ids.length} ${relationsPlural(ids.length)}.`;
    noticeShown.value = true;
    await load();
  } catch (err) {
    error.value =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się opublikować powiązań.";
    // Whatever went through before the failure is already live, so the list
    // has to be re-read rather than patched.
    await load();
  } finally {
    publishing.value = false;
  }
}

onMounted(() => load());
</script>

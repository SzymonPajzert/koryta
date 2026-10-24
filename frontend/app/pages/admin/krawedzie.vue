<template>
  <div class="w-100">
    <!-- The way back is a named link above the title rather than a bare arrow
         beside it, which pushed the h1 off the page's edge. -->
    <AdminPageHead
      title="Powiązania do opublikowania"
      lead="Powiązania, które można pokazać od razu: obie ich strony są już opublikowane."
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
    </AdminPageHead>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
      data-testid="edges-queue-error"
    />

    <!-- A row of controls, not a record, so no card round it. -->
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
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
      <!-- Tonal, the neutral control tint: as a text button its label sat
           16px in from the publish button's edge when it wrapped on a phone. -->
      <v-btn
        variant="tonal"
        :disabled="rows.length === 0"
        data-testid="edges-select-all"
        @click="toggleAll"
      >
        {{ allSelected ? "Odznacz wszystkie" : "Zaznacz wszystkie" }}
      </v-btn>
      <v-spacer />
      <!-- Only once a scan has answered: during the first one, or after it
           failed, „Przejrzano 0” would be a count nobody took. A reload keeps
           the previous figure until the new one arrives. -->
      <div v-if="scanned > 0" class="text-caption text-medium-emphasis">
        Przejrzano {{ polishNumber(scanned) }} {{ relationsPlural(scanned) }}
        <span v-if="truncated">
          · przerwano na limicie, użyj „Wczytaj więcej”</span
        >
      </div>
    </div>

    <!-- The bleed sits on a plain wrapper: on the table itself Vuetify's
         `.v-table { max-width: 100% }` holds it at the column's width, so
         on a phone the margins only shifted it left, its rules stopping 32px
         short of the right edge. -->
    <div class="k-bleed-xs">
      <v-data-table
        v-model="selected"
        density="compact"
        show-select
        item-value="id"
        :headers="headers"
        :items="rows"
        :loading="pending"
        :hide-default-body="rows.length === 0"
        items-per-page="-1"
        class="edges-queue"
        data-testid="edges-queue-table"
      >
        <template #[`item.relation`]="{ item }">
          <span
            class="edges-queue__text edges-queue__label font-weight-medium"
            >{{ label(item) }}</span
          >
        </template>
        <template #[`item.source`]="{ item }">
          <nuxt-link
            :to="`/admin/rewizje/${item.sourceId}`"
            class="edges-queue__text text-decoration-none text-primary"
          >
            {{ item.sourceName || item.sourceId }}
          </nuxt-link>
        </template>
        <template #[`item.target`]="{ item }">
          <nuxt-link
            :to="`/admin/rewizje/${item.targetId}`"
            class="edges-queue__text text-decoration-none text-primary"
          >
            {{ item.targetName || item.targetId }}
          </nuxt-link>
        </template>
        <!-- „—” for a relation with no dates, the sign the other admin pages
             put in an empty cell: a lone hyphen read as a stray mark. -->
        <template #[`item.dates`]="{ item }">
          <span class="text-caption">
            {{
              relationPeriodLabel(
                item.start_date ?? undefined,
                item.end_date ?? undefined,
              ) || "—"
            }}</span
          >
        </template>
        <template #bottom>
          <!-- With no rows, loading or none ready, the sentence goes under the
               head and outside the part that scrolls, from the start edge. As
               the table's own row it was centred on the table's whole width,
               which a phone scrolls sideways: „Ładowanie…” stood far right of
               the screen's middle, and the sentence for an empty queue ran
               off its edge. -->
          <p v-if="rows.length === 0" class="px-4 py-2">
            {{ pending ? "Ładowanie…" : emptyText }}
          </p>
          <!-- Only when there is more to read: an empty band under the last
               row otherwise. -->
          <div v-if="nextCursor" class="d-flex justify-center pa-3">
            <v-btn
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
    </div>

    <v-snackbar v-model="noticeShown" color="info" :timeout="6000">
      {{ notice }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiArrowLeft, mdiEarth } from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { edgeTypeLabels, relationsPlural } from "~/composables/edges";
import { polishCountingGenitive, polishNumber } from "~/composables/polish";
import { relationPeriodLabel } from "~/utils/relationPeriod";
import type {
  UnpublishedEdgeRow,
  UnpublishedEdges,
} from "~~/server/api/edges/unpublished.get";

definePageMeta({
  middleware: "admin",
});

useHead({
  title: "Powiązania do opublikowania (Admin) - koryta.pl",
});

// The text columns need a floor: `overflow-wrap: anywhere` drops their
// min-content width, and without one a phone squeezes „Od” and „Do” down to
// their two-letter headers, a name to a letter per line. With it the table
// scrolls sideways inside its strip instead.
const headers = [
  { title: "Powiązanie", key: "relation", sortable: false, minWidth: 140 },
  { title: "Od", key: "source", sortable: false, minWidth: 160 },
  { title: "Do", key: "target", sortable: false, minWidth: 160 },
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

// A scan that stopped on its limit found nothing to show in what it read, not
// in the queue: the ids at the front can all be waiting on drafts while ready
// ones sit further on. „Wczytaj więcej” is the way there, and it is a
// deliberate click rather than a loop because every round costs up to 3 000
// reads.
const emptyText = computed(() =>
  truncated.value
    ? `Wśród ${polishCountingGenitive(scanned.value, "przejrzanego powiązania", "przejrzanych powiązań")} nie ma gotowych - „Wczytaj więcej” sprawdzi kolejne.`
    : "Nie ma powiązań gotowych do publikacji.",
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

<style scoped>
/* An article's name is often a bare address or a long headline. It wraps in
   its cell instead of widening its column to the whole line; the columns'
   minWidth (in `headers`) stops that wrapping at a readable width. The period
   keeps its dates whole. */
.edges-queue__text {
  overflow-wrap: anywhere;
}

/* Ingest names come lower-case („kandydatura”, „współwłaściciel”) beside the
   sentence-case type labels („Zarząd”), so the column mixed the two row by
   row. Capitalised for display only: the text itself is what tests and the
   row's accessible name match on. ::first-letter needs a block container. */
.edges-queue__label {
  display: block;
}

.edges-queue__label::first-letter {
  text-transform: uppercase;
}
</style>

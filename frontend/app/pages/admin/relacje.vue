<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn :icon="mdiArrowLeft" variant="text" class="mr-2" to="/admin" />
      <div>
        <h1 class="text-h4">Powiązania osobiste - druga strona</h1>
        <div class="text-caption text-grey-darken-1">
          Powiązania między ludźmi mają jedno słowo, a czyta się je z dwóch
          stron: „żona” wpisana przy Janie pokazuje się też przy niej. Wpisz,
          jak powiązanie brzmi w drugą stronę.
        </div>
      </div>
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
      data-testid="reverse-queue-error"
    />

    <v-card class="mb-4 pa-3">
      <div class="d-flex align-center flex-wrap ga-3">
        <v-btn
          color="success"
          variant="tonal"
          :disabled="filledCount === 0"
          :loading="saving"
          :prepend-icon="mdiContentSaveCheckOutline"
          data-testid="reverse-save"
          @click="saveFilled()"
        >
          Zapisz wypełnione ({{ filledCount }})
        </v-btn>
        <!-- Only the rows the vocabulary has one answer for. A father's child
             is a "syn" or a "córka" and the relation says nothing about which,
             so those stay a click each - see `reverseRelationSuggestions`. -->
        <v-btn
          variant="text"
          size="small"
          :disabled="unambiguousCount === 0"
          :prepend-icon="mdiAutoFix"
          data-testid="reverse-fill-obvious"
          @click="fillUnambiguous"
        >
          Wypełnij oczywiste ({{ unambiguousCount }})
        </v-btn>
        <v-spacer />
        <div class="text-caption text-grey-darken-1">
          Przejrzano {{ scanned }} powiązań osobistych
          <span v-if="truncated">
            · przerwano na limicie, użyj „Wczytaj więcej”</span
          >
        </div>
      </div>
    </v-card>

    <!-- Stacked below `md` rather than scrolled sideways. A row here is two
         names, a word, a text field and a handful of chips, which on a phone
         is wider than the screen twice over - and the column that has to be
         reachable is the last one, the one a sideways scroll hides. -->
    <v-data-table
      density="compact"
      item-value="id"
      :headers="headers"
      :items="rows"
      :loading="pending"
      mobile-breakpoint="md"
      no-data-text="Każde powiązanie osobiste ma już obie strony."
      loading-text="Ładowanie..."
      items-per-page="-1"
      data-testid="reverse-queue-table"
    >
      <template #[`item.relation`]="{ item }">
        <div class="text-body-2">
          <nuxt-link
            :to="`/entity/person/${item.sourceId}`"
            class="text-decoration-none text-primary"
          >
            {{ item.sourceName || item.sourceId }}
          </nuxt-link>
          <v-icon :icon="mdiArrowRight" size="small" class="mx-1" />
          <nuxt-link
            :to="`/entity/person/${item.targetId}`"
            class="text-decoration-none text-primary"
          >
            {{ item.targetName || item.targetId }}
          </nuxt-link>
        </div>
        <div v-if="item.content" class="text-caption text-grey-darken-1">
          {{ item.content }}
        </div>
      </template>
      <template #[`item.name`]="{ item }">
        <span class="font-weight-medium">{{ item.name }}</span>
        <v-chip
          v-if="item.published"
          size="x-small"
          variant="tonal"
          color="warning"
          class="ml-2"
          title="Widoczne publicznie, więc błędny podpis jest teraz na stronie."
        >
          na żywo
        </v-chip>
      </template>
      <template #[`item.reverse`]="{ item }">
        <div class="d-flex align-center flex-wrap ga-2 py-2">
          <v-text-field
            v-model="drafts[item.id]"
            :label="`${item.targetName || 'druga osoba'} → ${item.sourceName || 'pierwsza osoba'}`"
            density="compact"
            hide-details
            variant="outlined"
            style="min-width: 220px"
            :data-testid="`reverse-input-${item.id}`"
          />
          <v-chip
            v-for="suggestion in suggestionsFor(item)"
            :key="suggestion"
            size="small"
            variant="tonal"
            :data-testid="`reverse-suggestion-${item.id}-${suggestion}`"
            @click="drafts[item.id] = suggestion"
          >
            {{ suggestion }}
          </v-chip>
        </div>
      </template>
      <template #bottom>
        <div class="d-flex justify-center pa-3">
          <v-btn
            v-if="nextCursor"
            variant="text"
            :loading="pending"
            data-testid="reverse-load-more"
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
/** The backlog of one-sided personal relations.
 *
 * Every `connection` written before `Edge.reverse_name` existed carries one
 * word and prints it on both people's pages, so half of them say something
 * false and no page shows which. This is the only place that lists them - see
 * /api/edges/missingReverse for why the query has to be a scan.
 *
 * A table rather than the one-relation dialog on the person's page because the
 * work is bulk by nature: the answer is usually the vocabulary's own first
 * suggestion, and the rows that are not obvious are the ones worth a human
 * reading them.
 */
import { computed, reactive, ref } from "vue";
import {
  mdiArrowLeft,
  mdiArrowRight,
  mdiAutoFix,
  mdiContentSaveCheckOutline,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { relationsPlural } from "~/composables/edges";
import { useScannedQueue } from "~/composables/scannedQueue";
import { reverseRelationSuggestions } from "~~/shared/relations";
import type { MissingReverseRow } from "~~/server/api/edges/missingReverse.get";
import type { ReverseNamesWritten } from "~~/server/api/edges/reverseNames.post";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({
  title: "Powiązania osobiste - druga strona (Admin) - koryta.pl",
});

const headers = [
  { title: "Kogo łączy", key: "relation", sortable: false },
  { title: "Mówi", key: "name", sortable: false, width: 200 },
  { title: "A w drugą stronę", key: "reverse", sortable: false },
];

const { rows, nextCursor, scanned, truncated, pending, error, load } =
  useScannedQueue<MissingReverseRow>("/api/edges/missingReverse");
/** What has been typed or clicked per row, keyed by edge id. Kept beside the
 * rows rather than on them so that reloading a page of the queue does not throw
 * away work in progress on the rows it keeps. */
const drafts = reactive<Record<string, string>>({});
const saving = ref(false);
const notice = ref<string | null>(null);
const noticeShown = ref(false);

function suggestionsFor(row: MissingReverseRow): string[] {
  return reverseRelationSuggestions(row.name).filter(
    (option) => option !== drafts[row.id],
  );
}

const filled = computed(() =>
  rows.value.filter((row) => (drafts[row.id] ?? "").trim().length > 0),
);
const filledCount = computed(() => filled.value.length);

/** The rows the vocabulary answers without a choice: one suggestion, and
 * nothing typed yet. */
const unambiguous = computed(() =>
  rows.value.filter((row) => {
    if ((drafts[row.id] ?? "").trim()) return false;
    return reverseRelationSuggestions(row.name).length === 1;
  }),
);
const unambiguousCount = computed(() => unambiguous.value.length);

function fillUnambiguous() {
  for (const row of unambiguous.value) {
    drafts[row.id] = reverseRelationSuggestions(row.name)[0]!;
  }
}

async function saveFilled() {
  const updates = filled.value.map((row) => ({
    edge_id: row.id,
    reverse_name: drafts[row.id]!.trim(),
  }));
  if (updates.length === 0) return;

  saving.value = true;
  error.value = null;
  const written: string[] = [];
  /** What went wrong, held rather than shown: the reload below starts by
   * clearing `error`, so a message set here would be wiped by the read that is
   * meant to confirm it. */
  let complaint: string | null = null;

  try {
    // The server caps a request at one batch, so a long list is sent in the
    // same chunks it will be committed in.
    for (let i = 0; i < updates.length; i += 100) {
      const result = await authRequest<ReverseNamesWritten>(
        "/api/edges/reverseNames",
        { body: { updates: updates.slice(i, i + 100) } },
      );
      written.push(...result.updated, ...result.unchanged);
      if (result.skipped.length > 0) {
        complaint = result.skipped
          .map((entry) => `${entry.edge_id}: ${entry.reason}`)
          .join(" · ");
      }
    }
    notice.value = `Uzupełniono ${written.length} ${relationsPlural(written.length)}.`;
    noticeShown.value = true;
    // Blanked rather than removed: the reload drops the rows anyway, and an
    // empty draft is what `filled` already reads as "not typed in".
    for (const id of written) drafts[id] = "";
  } catch (err) {
    complaint =
      (err as { data?: { message?: string } }).data?.message ||
      "Nie udało się zapisać powiązań.";
  } finally {
    saving.value = false;
  }

  // Whatever went through is already stored, so the queue is re-read rather
  // than patched - the same reason /admin/krawedzie reloads after publishing.
  await load();
  if (complaint) error.value = complaint;
}

onMounted(() => load());
</script>

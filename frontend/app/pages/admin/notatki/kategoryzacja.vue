<template>
  <v-container class="triage-container">
    <!-- Same two-line header as /ekstrakcje/kategoryzacja: the card is the
         point of the page, so the back button sits beside the title. -->
    <div class="d-flex align-center ga-2 mb-3">
      <v-btn
        variant="text"
        size="small"
        density="comfortable"
        :prepend-icon="mdiArrowLeft"
        to="/admin/notatki"
        class="ms-n2 flex-shrink-0"
      >
        Powrót
      </v-btn>
      <div class="header-text">
        <h1 class="text-subtitle-1 font-weight-medium text-truncate">
          Kategoryzuj notatki
        </h1>
        <div v-if="!pending" class="text-caption text-medium-emphasis">
          Pozostało do oceny: {{ remaining }}
        </div>
      </div>
      <v-spacer />
      <!-- One mistap on a phone is one wrong type, so the way back is on
           screen rather than in the table view. -->
      <v-btn
        v-if="history.length"
        variant="text"
        size="small"
        :prepend-icon="mdiUndoVariant"
        class="flex-shrink-0"
        @click="undo"
      >
        Cofnij
      </v-btn>
    </div>

    <div v-if="pending" class="d-flex justify-center py-8">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <!-- A failed fetch leaves the same empty queue as a cleared backlog, so
         say which it was. -->
    <div v-else-if="error" class="py-8 text-center">
      <v-alert type="error" variant="tonal">
        Nie udało się załadować notatek do kategoryzacji.
      </v-alert>
      <v-btn class="mt-4" color="primary" variant="tonal" @click="load()">
        Spróbuj ponownie
      </v-btn>
    </div>

    <!-- Two ways to run out: the batch is spent while the backlog behind it is
         not, or there is nothing left to categorize at all. -->
    <div v-else-if="!current && remaining > 0" class="py-8 text-center">
      <v-icon size="64" color="primary" class="mb-4">{{ mdiCheckAll }}</v-icon>
      <div class="text-h6">Ta porcja przejrzana!</div>
      <div class="text-body-2 text-medium-emphasis mt-1">
        Zostało jeszcze {{ remaining }} do oceny.
      </div>
      <v-btn class="mt-4" color="primary" variant="tonal" @click="load()">
        Wczytaj kolejne
      </v-btn>
    </div>

    <div v-else-if="!current" class="py-8 text-center">
      <v-icon size="64" color="success" class="mb-4">{{ mdiCheckAll }}</v-icon>
      <div class="text-h6">Wszystkie notatki skategoryzowane!</div>
      <div v-if="deferredCount" class="text-body-2 text-medium-emphasis mt-1">
        {{ deferredCount }}
        {{ deferredCount === 1 ? "notatka czeka" : "czeka" }} na ocenę w tabeli.
      </div>
      <v-btn class="mt-4" color="primary" variant="tonal" to="/admin/notatki">
        Wróć do tabeli
      </v-btn>
    </div>

    <template v-else>
      <div class="queue-area mx-auto">
        <NoteTriageCard :key="current.key" :row="current" />

        <v-list
          class="mt-4 rounded-lg border"
          density="comfortable"
          lines="two"
        >
          <v-list-item
            v-for="(config, value) in noteAdminTypeConfig"
            :key="value"
            :title="config.title"
            :subtitle="config.hint"
            class="py-2"
            @click="classify(value)"
          >
            <template #prepend>
              <v-avatar :color="config.color" variant="tonal" size="40">
                <v-icon :icon="config.icon" />
              </v-avatar>
            </template>
          </v-list-item>

          <v-divider class="my-1" />

          <!-- The escape hatch: the note, its url and - for a person or a
               company - the record under the list are all this view has, and
               sometimes that is not enough to say what the entry is about. -->
          <v-list-item
            title="Nie da się ocenić tutaj"
            subtitle="Trzeba zobaczyć węzeł - oceń w tabeli na komputerze."
            class="py-2"
            @click="defer"
          >
            <template #prepend>
              <v-avatar color="warning" variant="tonal" size="40">
                <v-icon :icon="mdiCommentQuestionOutline" />
              </v-avatar>
            </template>
          </v-list-item>
        </v-list>

        <!-- Who the note is about, so that a reviewer on a phone can read the
             record without switching to the table. Under the choices rather
             than above them: the note and a tap stay on the first screen, and
             this is what a reviewer scrolls to when they need it.

             Its own `<Suspense>`, keyed by the node. The section awaits its
             reads, which makes it an async component, and a boundary of its
             own is what gives it a fallback without holding up the card and
             the choices. The key starts each node from that fallback rather
             than leaving the last person under the next note while theirs
             loads; two entries on one node, the common case, keep the record
             already drawn. -->
        <Suspense v-if="showSubject" :key="current.nodeId">
          <LazyNoteTriageSubject :node-id="current.nodeId" class="mt-6" />
          <template #fallback>
            <div
              class="d-flex align-center justify-center ga-2 mt-6 py-4 text-caption text-medium-emphasis"
              data-testid="triage-subject-loading"
            >
              <v-progress-circular indeterminate size="16" width="2" />
              {{
                current.nodeType === "person"
                  ? "Ładowanie danych osoby…"
                  : "Ładowanie danych instytucji…"
              }}
            </div>
          </template>
        </Suspense>
      </div>
    </template>

    <v-snackbar
      :model-value="!!failure"
      color="error"
      timeout="4000"
      @update:model-value="failure = ''"
    >
      {{ failure }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import {
  mdiArrowLeft,
  mdiCheckAll,
  mdiCommentQuestionOutline,
  mdiUndoVariant,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { noteAdminTypeConfig } from "~/composables/notes";
import type { NodeType, NoteRow } from "~~/shared/model";

definePageMeta({
  middleware: "admin",
});

useHead({
  title: "Kategoryzacja notatek (Admin) - koryta.pl",
});

/** One sitting's worth of cards. The endpoint reads the whole collection to
 * answer at all, so a bigger page costs nothing extra - but a smaller one
 * means the count in the header is refreshed while the reviewer works. */
const QUEUE_SIZE = 50;

type Verdict = { adminType?: string | null; adminTypeDeferred?: boolean };

const queue = ref<NoteRow[]>([]);
const total = ref(0);
const pending = ref(true);
const error = ref(false);
/** What went wrong with the last write, if anything - a failed verdict and a
 * failed undo leave the queue in different states, so they say so. */
const failure = ref("");

/** Entries judged in this sitting, with what they looked like before - the
 * stack `Cofnij` pops, and what keeps a refetch from serving them again while
 * the write is still in flight. */
const history = ref<{ row: NoteRow; previous: Verdict }[]>([]);
const handled = computed(() => new Set(history.value.map((h) => h.row.key)));

/** How much of `history` the current `total` already accounts for. A second
 * batch is counted by a server that has seen the first batch's verdicts, so
 * subtracting the whole history from it would count those verdicts twice. */
const judgedBeforeLoad = ref(0);

const current = computed<NoteRow | undefined>(() => queue.value[0]);

/** The kinds of node whose record is drawn under the choices. Not a region:
 * its relations are every institution inside it and everyone who stood for
 * election there - hundreds of rows, and a heavy read, for nothing a reviewer
 * could take in on a phone. Not an article or a topic either, which the
 * relations endpoint does not carry at all. */
const SUBJECT_TYPES: NodeType[] = ["person", "place"];

const showSubject = computed(
  () =>
    !!current.value?.nodeType && SUBJECT_TYPES.includes(current.value.nodeType),
);

/** What the server counted when the batch was fetched, less what has been
 * judged since - the fetch cannot know about verdicts given after it. Undoing
 * a verdict from an earlier batch puts a card back that the count had already
 * dropped, so the difference is allowed to go negative and add it back. */
const remaining = computed(() =>
  Math.max(0, total.value - (history.value.length - judgedBeforeLoad.value)),
);

/** Only ever the entries this sitting handed to the table view: an older one
 * is already excluded by the `deferred: false` filter, so it is not in `total`
 * and would be a number the reviewer cannot act on from here. */
const deferredCount = computed(
  () => history.value.filter((h) => h.row.adminTypeDeferred).length,
);

const load = async (): Promise<void> => {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  pending.value = true;
  error.value = false;
  try {
    const res = await authRequest<{ notes: NoteRow[]; total: number }>(
      "/api/notes/admin",
      {
        method: "GET",
        query: {
          // Untriaged, and not already handed back to the table view.
          adminType: "none",
          deferred: "false",
          limit: QUEUE_SIZE,
          page: 1,
          sortBy: "createdAt",
          sortDesc: "true",
        },
      },
    );
    // A verdict this sitting gave may not be reflected in a batch fetched
    // right after it, and serving the same card twice would leave the queue
    // looping over entries the reviewer has already judged.
    queue.value = res.notes.filter((row) => !handled.value.has(row.key));
    total.value = res.total;
    judgedBeforeLoad.value = history.value.length;
  } catch (err) {
    console.error("Failed to load notes to categorize", err);
    error.value = true;
    queue.value = [];
    total.value = 0;
    judgedBeforeLoad.value = history.value.length;
  } finally {
    pending.value = false;
  }
};

const save = async (row: NoteRow, verdict: Verdict) => {
  await authRequest("/api/notes/admin", {
    method: "POST",
    body: { noteId: row.noteId, sourceIndex: row.sourceIndex, ...verdict },
  });
};

/** Judge the current card and move on without waiting for the round trip -
 * the whole point of the queue is that one verdict is one tap. A write that
 * fails puts the card back at the front rather than losing it. */
const record = async (verdict: Verdict) => {
  const row = current.value;
  if (!row) return;

  const previous: Verdict = {
    adminType: row.adminType,
    adminTypeDeferred: row.adminTypeDeferred,
  };
  Object.assign(row, {
    adminType: verdict.adminType ?? null,
    adminTypeDeferred: verdict.adminTypeDeferred ?? false,
  });
  queue.value = queue.value.slice(1);
  history.value = [...history.value, { row, previous }];

  // Fetching the next batch before the queue is empty would risk showing a
  // card twice, so the refill waits for the last card to be judged.
  if (queue.value.length === 0 && remaining.value > 0) void load();

  try {
    await save(row, verdict);
  } catch (err) {
    console.error("Failed to save the note category", err);
    Object.assign(row, previous);
    history.value = history.value.filter((entry) => entry.row.key !== row.key);
    queue.value = [row, ...queue.value];
    failure.value = "Nie udało się zapisać oceny. Notatka wróciła do kolejki.";
  }
};

const classify = (adminType: string) =>
  record({ adminType, adminTypeDeferred: false });

/** This view holds the note, its url and at most the node's record; when that
 * is not enough, the entry goes to the table rather than back around this
 * queue. */
const defer = () => record({ adminType: null, adminTypeDeferred: true });

const undo = async () => {
  const last = history.value.at(-1);
  if (!last) return;

  history.value = history.value.slice(0, -1);
  Object.assign(last.row, {
    adminType: last.previous.adminType ?? null,
    adminTypeDeferred: last.previous.adminTypeDeferred ?? false,
  });
  queue.value = [last.row, ...queue.value];

  try {
    await save(last.row, {
      adminType: last.previous.adminType ?? null,
      adminTypeDeferred: last.previous.adminTypeDeferred ?? false,
    });
  } catch (err) {
    // The card is back on screen either way; what did not happen is the
    // clearing of what the mistap wrote, which the next verdict will redo.
    console.error("Failed to undo the note category", err);
    failure.value = "Nie udało się cofnąć oceny w bazie.";
  }
};

onMounted(load);
</script>

<style scoped>
.triage-container {
  max-width: 600px;
}

/* Let the title ellipsize instead of pushing the back button off the row. */
.header-text {
  min-width: 0;
}

/* A phone has the least room to spare above the card. */
@media (max-width: 599px) {
  .triage-container {
    padding-top: 8px;
  }
}

.queue-area {
  max-width: 520px;
}
</style>

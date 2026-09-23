<template>
  <v-container>
    <v-row>
      <v-col cols="12" class="d-flex align-start flex-wrap ga-2">
        <div class="flex-1-1">
          <h1 class="text-h4 mb-4">Zgłoszenia od użytkowników</h1>
          <p class="text-body-2 text-medium-emphasis">
            Wszystko, co ktoś nam napisał: przyciskiem „Zgłoś” i oceniając wpisy
            na
            <NuxtLink to="/qa">liście zmian do sprawdzenia</NuxtLink>.
          </p>
        </div>
        <v-btn
          :prepend-icon="ordering ? mdiCheck : mdiSort"
          :color="ordering ? 'primary' : undefined"
          :variant="ordering ? 'flat' : 'outlined'"
          :disabled="pending && !ordering"
          @click="toggleOrdering"
        >
          {{ ordering ? "Gotowe" : "Ułóż kolejkę" }}
        </v-btn>
      </v-col>
    </v-row>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>
    <v-alert v-if="openTruncated" type="warning" variant="tonal" class="mb-4">
      Otwartych zgłoszeń jest ponad {{ OPEN_CAP }} - lista i kolejka są
      niepełne.
    </v-alert>
    <v-alert
      v-if="missingTarget"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      Nie ma takiego zgłoszenia.
    </v-alert>

    <v-progress-linear v-if="pending" indeterminate class="mb-4" />

    <FeedbackOrderList
      v-if="ordering"
      :inert="pending"
      :queue="queue"
      :inbox="inbox"
      :fix-states="fixStates"
      @move="moveTo"
      @remove="(item) => setRank(item, null)"
    />

    <template v-else>
      <template v-for="section in sections" :key="section.key">
        <!-- Closed reports are the record of what was asked for, so they stay
             on the page - folded, because nobody has to read them again. -->
        <v-btn
          v-if="section.key === 'closed' && closed.length > 0"
          variant="text"
          class="mb-2"
          :prepend-icon="showClosed ? mdiChevronUp : mdiChevronDown"
          data-toggle-closed
          @click="showClosed = !showClosed"
        >
          {{
            showClosed
              ? "Ukryj zamknięte"
              : `Pokaż zamknięte (${closed.length})`
          }}
        </v-btn>
        <div
          v-if="section.items.length > 0"
          class="d-flex align-center ga-2 mt-2 mb-2"
          :data-section="section.key"
        >
          <h2 class="text-subtitle-1 font-weight-bold">{{ section.title }}</h2>
          <v-chip size="x-small" label>{{ section.items.length }}</v-chip>
          <InfoBubble :label="section.title">{{ section.info }}</InfoBubble>
        </div>

        <!-- The id is what the "Otwórz w panelu" button in Slack links to. -->
        <v-card
          v-for="item in section.items"
          :id="`fb-${item.id}`"
          :key="item.id"
          class="mb-4"
          :class="{
            'feedback-settled': isSettled(item),
            'feedback-target': targetId === item.id,
          }"
          :data-feedback-id="item.id"
        >
          <v-row no-gutters>
            <v-col cols="12" md="8" class="pa-4 border-e">
              <div class="d-flex align-center flex-wrap ga-2 mb-2">
                <span
                  v-if="positions.has(item.id!)"
                  class="text-subtitle-1 font-weight-bold"
                  data-queue-position
                >
                  #{{ positions.get(item.id!) }}
                </span>
                <v-chip
                  :color="feedbackKindConfig[item.kind].color"
                  size="small"
                  variant="tonal"
                >
                  <v-icon start :icon="feedbackKindConfig[item.kind].icon" />
                  {{ feedbackKindConfig[item.kind].title }}
                </v-chip>
                <!-- A link to the card itself, so its id can be copied: the
                     same #fb-<id> anchor Slack's "Otwórz w panelu" uses, and
                     what a QA entry names in `fixes`. -->
                <a
                  :href="`#fb-${item.id}`"
                  class="text-caption text-medium-emphasis"
                  title="Link do tego zgłoszenia"
                >
                  {{ formatDate(item.createdAt) }}
                </a>
                <UserChip v-if="item.userUid" :uid="item.userUid" />
                <v-chip v-else size="x-small" label variant="outlined">
                  anonimowo
                </v-chip>
              </div>

              <p class="text-body-1 mb-3" style="white-space: pre-wrap">
                {{ item.message }}
              </p>

              <div class="d-flex align-center flex-wrap ga-2">
                <!-- A verdict left on a QA changelog entry arrives here like
                     any other report; what it needs on the card is the entry
                     it was about, not the /qa route every one of them carries. -->
                <template v-if="item.context.qa">
                  <v-chip
                    size="x-small"
                    label
                    color="info"
                    :to="`/qa#qa-${item.context.qa.itemId}`"
                  >
                    <v-icon start :icon="mdiClipboardCheckOutline" />
                    QA: {{ item.context.qa.title }}
                  </v-chip>
                  <v-chip
                    size="x-small"
                    label
                    variant="tonal"
                    :color="
                      item.context.qa.status === 'ok' ? 'success' : 'error'
                    "
                  >
                    {{ qaStatusLabels[item.context.qa.status] }}
                  </v-chip>
                </template>
                <v-chip v-else size="x-small" label :to="pageLink(item)">
                  <v-icon start :icon="mdiLinkVariant" />
                  {{ item.context.pageTitle || item.context.route }}
                </v-chip>
                <!-- A change on the QA list says it fixes this report. -->
                <FeedbackFixChip
                  v-if="fixInfo.has(item.id!)"
                  :entries="fixInfo.get(item.id!)!.entries"
                  :state="fixInfo.get(item.id!)!.state"
                  :verdicts="fixInfo.get(item.id!)!.verdicts"
                  :blocked="fixInfo.get(item.id!)!.blocked"
                  :follow-ups="fixInfo.get(item.id!)!.followUps"
                  :reporter-uid="item.userUid"
                />
                <!-- This report was written while checking such a change:
                     the way back to what the change was fixing. -->
                <v-chip
                  v-for="target in fixTargets.get(item.id!) ?? []"
                  :key="target.id"
                  size="x-small"
                  label
                  variant="outlined"
                  :to="{ hash: `#fb-${target.id}` }"
                  :title="target.message"
                  data-fix-target
                >
                  <v-icon start :icon="mdiArrowULeftTop" />
                  dotyczy zgłoszenia
                </v-chip>
                <v-chip
                  v-if="item.slack?.state === 'failed'"
                  size="x-small"
                  label
                  color="warning"
                  variant="tonal"
                >
                  nie trafiło na Slacka
                </v-chip>
                <v-chip
                  v-if="item.contact"
                  size="x-small"
                  label
                  color="primary"
                >
                  <v-icon start :icon="mdiEmailOutline" />
                  {{ item.contact }}
                </v-chip>
              </div>
            </v-col>

            <v-col cols="12" md="4" class="pa-4">
              <v-btn
                v-if="fixInfo.get(item.id!)?.close"
                class="mb-3 me-2"
                size="small"
                variant="tonal"
                color="ink-success"
                :prepend-icon="mdiCheckAll"
                :loading="saving[item.id!]"
                @click="updateAdmin(item, { adminStatus: 'resolved' })"
              >
                Zamknij jako załatwione
              </v-btn>
              <v-btn
                v-if="section.key === 'inbox'"
                class="mb-3"
                size="small"
                variant="tonal"
                color="ink-sage"
                :prepend-icon="mdiPlaylistPlus"
                @click="moveTo(item, queue.length)"
              >
                Do kolejki
              </v-btn>
              <v-select
                :model-value="item.adminStatus"
                :items="statusOptions"
                label="Status"
                density="compact"
                variant="outlined"
                hide-details
                class="mb-2"
                :loading="saving[item.id!]"
                @update:model-value="
                  (val) => updateAdmin(item, { adminStatus: val })
                "
              />
              <v-textarea
                :model-value="item.adminNote ?? ''"
                label="Notatka"
                density="compact"
                variant="outlined"
                rows="2"
                auto-grow
                hide-details
                :loading="saving[item.id!]"
                @update:model-value="(val) => (draftNotes[item.id!] = val)"
                @blur="saveNote(item)"
              />
            </v-col>
          </v-row>
        </v-card>
      </template>
    </template>

    <v-alert v-if="!pending && items.length === 0" type="info" variant="tonal">
      Nic jeszcze nie wpłynęło.
    </v-alert>

    <v-snackbar v-model="snackbar" :timeout="4000" color="error">
      {{ snackbarText }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, onMounted, watch } from "vue";
import {
  mdiArrowULeftTop,
  mdiCheck,
  mdiCheckAll,
  mdiChevronDown,
  mdiChevronUp,
  mdiClipboardCheckOutline,
  mdiEmailOutline,
  mdiLinkVariant,
  mdiPlaylistPlus,
  mdiSort,
} from "@mdi/js";
import { authRequest } from "~/composables/auth";
import { useQaChecks } from "~/composables/qa";
import { feedbackKindConfig } from "~/composables/feedback";
import {
  compareNewest,
  compareQueue,
  feedbackSection,
  isSettled,
  OPEN_CAP,
  rankForSlot,
  renumberQueue,
  slotHasRoom,
} from "~~/shared/feedbackQueue";
import {
  blocksClosing,
  fixIndex,
  fixState,
  fixTargetsOf,
  followUpsOf,
  suggestClose,
  type FixState,
} from "~~/shared/feedbackFixes";
import {
  QA_ITEMS,
  qaStatusLabels,
  type QaCheck,
  type QaItem,
} from "~~/shared/qa";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

definePageMeta({
  middleware: "admin",
});

/** Which reports the QA list says it fixes. Built once: the list is code. */
const fixes = fixIndex(QA_ITEMS);

const route = useRoute();
/** Verdicts from /qa. Re-read with every load of the list: this page judges
 * other people's verdicts, and a copy from earlier in the session would
 * disagree with the follow-up reports the list has just brought in. */
const {
  checks,
  checksFor,
  loaded: checksLoaded,
  load: loadChecks,
} = useQaChecks();

const items = ref<Feedback[]>([]);
const pending = ref(true);
const loadError = ref("");
const openTruncated = ref(false);
const saving = ref<Record<string, boolean>>({});
const draftNotes = ref<Record<string, string>>({});
/** Ids that were settled when the list was loaded - see `feedbackSection`. */
const settledAtLoad = ref(new Set<string>());
const ordering = ref(false);
const showClosed = ref(false);
/** The report a `#fb-<id>` link pointed at, outlined for a moment. */
const targetId = ref<string | null>(null);
const missingTarget = ref(false);
const snackbar = ref(false);
const snackbarText = ref("");

const statusOptions = [
  { title: "Nowe", value: "new" },
  { title: "W trakcie", value: "in_progress" },
  { title: "Załatwione", value: "resolved" },
  { title: "Nie robimy", value: "wont_fix" },
];

const sectionOf = (item: Feedback) =>
  feedbackSection(item, settledAtLoad.value.has(item.id!));

/** What gets worked on next, in order. */
const queue = computed(() =>
  items.value.filter((item) => sectionOf(item) === "queue").sort(compareQueue),
);
/** Open, but nobody has decided where it goes yet. */
const inbox = computed(() =>
  items.value.filter((item) => sectionOf(item) === "inbox").sort(compareNewest),
);
const closed = computed(() =>
  items.value
    .filter((item) => sectionOf(item) === "closed")
    .sort(compareNewest),
);

/** Place in the queue, 1-based, for the "#1" on a card. */
const positions = computed(
  () => new Map(queue.value.map((item, index) => [item.id!, index + 1])),
);

/** What has not been given a place comes first: once the queue has been
 * ordered it is short - whatever arrived since - and it is what somebody
 * opening the page from the dashboard or from Slack came to look at. */
const sections = computed(() => [
  {
    key: "inbox",
    title: "Poza kolejką",
    info: "Jeszcze bez miejsca w kolejce. „Do kolejki” dopisuje zgłoszenie na koniec.",
    items: inbox.value,
  },
  {
    key: "queue",
    title: "Kolejka",
    info: "Od góry: co robimy najpierw. Kolejność zmienia się przyciskiem „Ułóż kolejkę”.",
    items: queue.value,
  },
  {
    key: "closed",
    title: "Zamknięte",
    info: "Załatwione albo takie, których nie robimy.",
    items: showClosed.value ? closed.value : [],
  },
]);

/** For each report a QA entry claims to fix: the entries (newest first),
 * the reports written while checking them, where the fix stands, and whether
 * to offer closing the report. */
const fixInfo = computed(() => {
  const info = new Map<
    string,
    {
      entries: QaItem[];
      followUps: Feedback[];
      state: FixState | null;
      verdicts: QaCheck[];
      close: boolean;
      blocked: boolean;
    }
  >();
  for (const item of items.value) {
    const entries = fixes.get(item.id!);
    if (!entries) continue;
    const followUps = followUpsOf(item, entries, items.value);
    const state = checksLoaded.value
      ? fixState(entries[0]!, checks.value)
      : null;
    info.set(item.id!, {
      entries,
      followUps,
      state,
      verdicts: checksFor(entries[0]!.id),
      close: !!state && suggestClose(item, state, followUps),
      blocked:
        !isSettled(item) && state === "works" && followUps.some(blocksClosing),
    });
  }
  return info;
});

/** The same, reduced to the state, for the one-line rows of ordering mode. */
const fixStates = computed(
  () =>
    new Map([...fixInfo.value].map(([id, { state }]) => [id, state] as const)),
);

/** For a report written while checking a fix: the reports it was a fix for. */
const fixTargets = computed(() => {
  const targets = new Map<string, Feedback[]>();
  for (const item of items.value) {
    const found = fixTargetsOf(item, fixes, items.value);
    if (found.length > 0) targets.set(item.id!, found);
  }
  return targets;
});

/** Reports are written by anyone, including signed-out visitors, so the route
 * is never trusted as a link target. The API only accepts site-relative paths;
 * this refuses anything else outright rather than rendering it. */
const pageLink = (item: Feedback) =>
  /^\/(?!\/)/.test(item.context.route) ? item.context.route : undefined;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });

/** The report a `#fb-<id>` hash names, if it does. The router has already
 * decoded the hash. */
const hashTarget = () => /^#fb-(.+)$/.exec(route.hash)?.[1] ?? null;

/** Ranks as the server last confirmed them, for undoing a move it refused.
 * Filled lazily by `setRank`, emptied by every load. */
const confirmedRanks = new Map<string, number | undefined>();
/** How many moves of each report have been made, so a refused move knows
 * whether a later one has already replaced it on screen. */
const rankMoves = new Map<string, number>();

const load = async () => {
  pending.value = true;
  loadError.value = "";
  // Not awaited: the list is useful without the verdicts, and the chips say
  // nothing about a fix until they arrive.
  loadChecks(true);
  try {
    const include = hashTarget();
    const data = await authRequest<{
      feedback: Feedback[];
      openTruncated?: boolean;
    }>("/api/feedback/list", {
      method: "GET",
      // A link from Slack can point at a report too old to be in the list.
      ...(include ? { query: { include } } : {}),
    });
    items.value = data.feedback;
    confirmedRanks.clear();
    openTruncated.value = !!data.openTruncated;
    settledAtLoad.value = new Set(
      data.feedback.filter(isSettled).map((item) => item.id!),
    );
  } catch (error) {
    console.error("Failed to load feedback", error);
    loadError.value = "Nie udało się wczytać zgłoszeń.";
  } finally {
    pending.value = false;
  }
};

/** Bring the report a link points at into view: the cards arrive after the
 * router has already tried to scroll to it, and a closed one is folded away. */
async function focusTarget() {
  const id = hashTarget();
  missingTarget.value = false;
  if (!id || ordering.value) return;
  const item = items.value.find((entry) => entry.id === id);
  if (!item) {
    missingTarget.value = !pending.value && !loadError.value;
    return;
  }
  if (sectionOf(item) === "closed") showClosed.value = true;
  targetId.value = id;
  await nextTick();
  document
    .getElementById(`fb-${id}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    if (targetId.value === id) targetId.value = null;
  }, 2000);
}

// A link followed while the page is open can name a report that arrived after
// it loaded, or a closed one older than the list goes back - so look again
// before saying there is no such report.
watch(
  () => route.hash,
  async () => {
    const id = hashTarget();
    if (id && !ordering.value && !items.value.some((e) => e.id === id)) {
      await load();
    }
    await focusTarget();
  },
);

/** Status and note saves still in flight, so a reload waits for them rather
 * than reading the report from before the save. */
const saves = new Set<Promise<unknown>>();

const updateAdmin = async (
  item: Feedback,
  patch: { adminStatus?: FeedbackStatus; adminNote?: string },
) => {
  const id = item.id;
  if (!id) return;
  saving.value[id] = true;
  const request = authRequest("/api/feedback/admin", {
    method: "POST",
    body: { id, ...patch },
  });
  saves.add(request);
  try {
    await request;
    // Onto the report as it is now: a reload may have replaced `item`.
    Object.assign(items.value.find((entry) => entry.id === id) ?? item, patch);
  } catch (error) {
    console.error("Failed to update feedback", error);
  } finally {
    saves.delete(request);
    saving.value[id] = false;
  }
};

/** Only when the text changed: tabbing through the page is not an edit. */
function saveNote(item: Feedback) {
  const draft = draftNotes.value[item.id!];
  if (draft === undefined || draft === (item.adminNote ?? "")) return;
  updateAdmin(item, { adminNote: draft });
}

const showRank = (item: Feedback, rank: number | undefined) => {
  if (rank === undefined) delete item.queueRank;
  else item.queueRank = rank;
};

/** Rank writes go out one at a time, in the order they were made, so two
 * quick moves cannot land the other way round. Each is shown at once. One the
 * server refuses puts its reports back where the server has them - except any
 * report a later move has already moved again on screen, which then stands or
 * falls on its own write.
 *
 * `renumber` rides along in the same request when the queue had to be spaced
 * out first; the server writes it and the move in one batch. */
let rankWrites: Promise<unknown> = Promise.resolve();

function setRank(
  item: Feedback,
  rank: number | null,
  renumber: { item: Feedback; rank: number }[] = [],
) {
  const moves = [{ item, rank }, ...renumber].map(({ item: moved, rank }) => {
    const id = moved.id!;
    if (!confirmedRanks.has(id)) confirmedRanks.set(id, moved.queueRank);
    const move = (rankMoves.get(id) ?? 0) + 1;
    rankMoves.set(id, move);
    showRank(moved, rank ?? undefined);
    return { item: moved, id, rank, move };
  });

  rankWrites = rankWrites.then(() =>
    authRequest("/api/feedback/admin", {
      method: "POST",
      body: {
        id: item.id,
        queueRank: rank,
        ...(renumber.length > 0
          ? {
              renumber: renumber.map(({ item: other, rank }) => ({
                id: other.id,
                queueRank: rank,
              })),
            }
          : {}),
      },
    }).then(
      () => {
        for (const { id, rank } of moves) {
          confirmedRanks.set(id, rank ?? undefined);
        }
      },
      (error) => {
        console.error("Failed to move feedback", error);
        for (const { item: moved, id, move } of moves) {
          if (rankMoves.get(id) === move) {
            showRank(moved, confirmedRanks.get(id));
          }
        }
        snackbarText.value = "Nie udało się zapisać kolejności.";
        snackbar.value = true;
      },
    ),
  );
  return rankWrites;
}

/** Put a report at `index` of the queue, counted without it. When the
 * neighbours there have no gap left between them, the rest of the queue is
 * spaced out again first, in the same write. */
function moveTo(item: Feedback, index: number) {
  const others = queue.value.filter((entry) => entry.id !== item.id);
  if (slotHasRoom(others, index)) {
    return setRank(item, rankForSlot(others, index));
  }
  const renumber = renumberQueue(others);
  const spaced = others.map((other) => ({
    ...other,
    queueRank:
      renumber.find((entry) => entry.item === other)?.rank ?? other.queueRank,
  }));
  return setRank(item, rankForSlot(spaced, index), renumber);
}

/** Ordering starts from a fresh list: a rank is computed from the neighbours
 * on screen, so they had better be the ones in the database. The list stays
 * inert until they are. */
async function toggleOrdering() {
  if (ordering.value) {
    ordering.value = false;
    await rankWrites;
    return;
  }
  ordering.value = true;
  pending.value = true;
  await Promise.allSettled([rankWrites, ...saves]);
  await load();
}

onMounted(async () => {
  await load();
  await focusTarget();
});
</script>

<style scoped>
/* Greyed rather than hidden: a report closed from its card stays where it was
 * until the next load (see `feedbackSection`), and the closed ones below are
 * the record of what was asked for. Hover and keyboard focus bring it back to
 * full contrast so it stays readable and its status select stays usable. */
.feedback-settled {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.feedback-settled:hover,
.feedback-settled:focus-within {
  opacity: 1;
}

/* Where a link landed, for long enough to find it on the page. */
.feedback-target {
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}
</style>

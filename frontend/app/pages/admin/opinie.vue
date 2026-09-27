<template>
  <div class="w-100">
    <div class="d-flex align-start flex-wrap ga-2 mb-2">
      <div class="flex-1-1">
        <h1 class="text-h5 text-sm-h4 mb-2">Zgłoszenia od użytkowników</h1>
        <p class="text-body-2 text-medium-emphasis">
          Wszystko, co ktoś nam napisał: przyciskiem „Zgłoś” i oceniając wpisy
          na
          <NuxtLink to="/qa">liście zmian do sprawdzenia</NuxtLink>.
        </p>
      </div>
      <v-btn-toggle
        v-model="view"
        mandatory
        divided
        variant="outlined"
        density="comfortable"
        :disabled="pending"
        data-view-toggle
      >
        <v-btn value="kolejka" class="text-none" :prepend-icon="mdiSort">
          Kolejka
        </v-btn>
        <v-btn
          value="lista"
          class="text-none"
          :prepend-icon="mdiFormatListBulleted"
        >
          Pełna lista
        </v-btn>
      </v-btn-toggle>
    </div>

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

    <template v-if="queueView">
      <!-- Not before the first answer: an empty queue says to drop a report
           on it, which is not what a page still loading should say. -->
      <FeedbackOrderList
        v-if="items.length > 0"
        :inert="pending"
        :queue="queue"
        :inbox="inbox"
        :row="reportRow"
        @move="moveTo"
        @remove="(item) => setRank(item, null)"
      />
    </template>

    <template v-else>
      <!-- What it shows, not what it counts: the numbers, the "#1" on a row
           and "Do kolejki" all go by the whole queue, so a report keeps its
           place whichever of these is on. -->
      <FeedbackFilterChips
        v-if="items.length > 0"
        v-model="source"
        :options="sourceOptions"
        class="mb-2"
      />

      <template v-for="section in sections" :key="section.key">
        <template v-if="section.count > 0">
          <AdminSectionHead
            :title="section.title"
            :count="section.count"
            :info="section.info"
            :data-section="section.key"
          >
            <!-- Closed reports are the record of what was asked for, so they
                 stay on the page - folded, because nobody has to read them
                 again. -->
            <v-btn
              v-if="section.key === 'closed'"
              variant="text"
              size="small"
              :prepend-icon="showClosed ? mdiChevronUp : mdiChevronDown"
              data-toggle-closed
              @click="showClosed = !showClosed"
            >
              {{
                showClosed
                  ? "Ukryj zamknięte"
                  : `Pokaż zamknięte (${section.count})`
              }}
            </v-btn>
          </AdminSectionHead>

          <AdminRowList v-if="section.items.length > 0" class="mb-4">
            <FeedbackReportRow
              v-for="item in section.items"
              :key="item.id"
              v-bind="reportRow(item)"
              :can-queue="section.key === 'inbox'"
              @queue="moveTo(item, queue.length)"
            />
          </AdminRowList>
        </template>
      </template>

      <p
        v-if="!pending && items.length > 0 && openShown === 0"
        class="text-body-2 text-medium-emphasis my-4"
      >
        Nic otwartego w tym widoku.
      </p>
    </template>

    <v-alert v-if="!pending && items.length === 0" type="info" variant="tonal">
      Nic jeszcze nie wpłynęło.
    </v-alert>

    <v-snackbar v-model="snackbar" :timeout="4000" color="error">
      {{ snackbarText }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiFormatListBulleted,
  mdiSort,
} from "@mdi/js";
import { useFeedbackAdmin } from "~/composables/feedbackAdmin";
import { sameQuery, useQueryFilters } from "~/composables/queryFilters";
import { OPEN_CAP } from "~~/shared/feedbackQueue";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

definePageMeta({
  middleware: "admin",
  // One column of one-line rows: past this the lines only get emptier.
  maxWidth: 1100,
});

useHead({ title: "Zgłoszenia (Admin) - koryta.pl" });

const route = useRoute();
const router = useRouter();

const {
  items,
  pending,
  loadError,
  openTruncated,
  load: loadReports,
  sectionOf,
  queue,
  inbox,
  closed,
  positions,
  fixInfo,
  fixTargets,
  saving,
  draftNotes,
  updateAdmin,
  saveNote,
  setRank,
  moveTo,
  writesSettled,
  snackbar,
  snackbarText,
} = useFeedbackAdmin();

const showClosed = ref(false);
const missingTarget = ref(false);
/** Rows that are open. Kept here rather than in each row so a link can open
 * the one it points at, and so a row stays open while the sections around it
 * are re-sorted - or while the page switches to the other view. */
const openRows = reactive(new Set<string>());

const setOpen = (id: string, open: boolean) =>
  open ? openRows.add(id) : openRows.delete(id);

/** How the page lists the reports.
 *
 * The queue is where the work gets done, so the page opens on it: what comes
 * next, in order, with what nobody has placed yet under it, and every report
 * a line that opens in place to be answered with a note or closed - as the
 * rows of the full list do. The full list adds what an order has no use for:
 * the closed reports, and the filter by where a report came from - a move is
 * counted among the whole queue, so the queue cannot be ordered through a
 * filter. */
type View = "kolejka" | "lista";

const { choiceFilter } = useQueryFilters();
const viewParam = choiceFilter<View>("widok", "kolejka");
const view = computed<View>({
  // Anything the url says that is not the full list is the queue.
  get: () => (viewParam.value === "lista" ? "lista" : "kolejka"),
  set: (value) => (viewParam.value = value),
});
const queueView = computed(() => view.value === "kolejka");

/** Which reports to show: all of them, only the ones sent with the „Zgłoś”
 * button, or only the verdicts from /qa. The two arrive through one intake
 * and are worked through in one queue - this only narrows the view. */
type Source = "wszystkie" | "zgloszenia" | "qa";
const SOURCES: readonly Source[] = ["wszystkie", "zgloszenia", "qa"];

const sourceParam = choiceFilter<Source>("zrodlo", "wszystkie");
/** Anything the url says that is not a view is the default one. */
const source = computed<Source>({
  get: () =>
    SOURCES.includes(sourceParam.value) ? sourceParam.value : "wszystkie",
  set: (value) => (sourceParam.value = value),
});

const fromQa = (item: Feedback) => !!item.context.qa;

const shows = (item: Feedback) =>
  source.value === "wszystkie" || fromQa(item) === (source.value === "qa");

/** Counted over what is still open - the closed ones have their own count on
 * the fold. */
const sourceOptions = computed(
  (): { value: Source; title: string; count: number }[] => {
    const open = [...inbox.value, ...queue.value];
    const qa = open.filter(fromQa).length;
    return [
      { value: "wszystkie", title: "Wszystkie", count: open.length },
      { value: "zgloszenia", title: "Zgłoszenia", count: open.length - qa },
      { value: "qa", title: "Z QA", count: qa },
    ];
  },
);

const shownInbox = computed(() => inbox.value.filter(shows));
const shownQueue = computed(() => queue.value.filter(shows));
const shownClosed = computed(() => closed.value.filter(shows));

/** What has not been given a place comes first: once the queue has been
 * ordered it is short - whatever arrived since - and it is what somebody
 * opening the page from the dashboard or from Slack came to look at. */
const sections = computed(() => [
  {
    key: "inbox",
    title: "Poza kolejką",
    info: "Jeszcze bez miejsca w kolejce. „Do kolejki” dopisuje zgłoszenie na koniec.",
    items: shownInbox.value,
    count: shownInbox.value.length,
  },
  {
    key: "queue",
    title: "Kolejka",
    info: "Od góry: co robimy najpierw. Kolejność zmienia się w widoku „Kolejka”.",
    items: shownQueue.value,
    count: shownQueue.value.length,
  },
  {
    key: "closed",
    title: "Zamknięte",
    info: "Załatwione albo takie, których nie robimy.",
    items: showClosed.value ? shownClosed.value : [],
    // Counted folded too: the fold says how much is behind it.
    count: shownClosed.value.length,
  },
]);

/** Open reports in view, for saying so when a filter leaves none. */
const openShown = computed(
  () => shownInbox.value.length + shownQueue.value.length,
);

/** The report a `#fb-<id>` hash names, if it does. The router has already
 * decoded the hash. */
const hashTarget = () => /^#fb-(.+)$/.exec(route.hash)?.[1] ?? null;

/** The report the url points at, marked for as long as it does rather than
 * for a moment: the link is followed to find one report among the rest and
 * settle it, which can take scrolling away and back, and a mark that fades
 * leaves nothing to find it by. */
const targetId = computed(hashTarget);

/** A link from Slack can point at a report too old to be in the list. */
const load = () => loadReports(hashTarget());

/** Everything a report's row takes from the page, in either view: a report
 * opened in the queue is the same row the full list opens, answered and
 * closed the same way. */
const reportRow = (item: Feedback) => {
  const id = item.id!;
  return {
    item,
    position: positions.value.get(id),
    fix: fixInfo.value.get(id),
    fixTargets: fixTargets.value.get(id),
    saving: saving.value[id],
    highlighted: targetId.value === id,
    expanded: openRows.has(id),
    "onUpdate:expanded": (open: boolean) => setOpen(id, open),
    onStatus: (adminStatus: FeedbackStatus) =>
      updateAdmin(item, { adminStatus }),
    onDraft: (note: string) => (draftNotes.value[id] = note),
    onSaveNote: () => saveNote(item),
  };
};

/** A link to a part of the page rather than to one report: the dashboard's,
 * to the reports nobody has placed yet (`FEEDBACK_INBOX_ANCHOR`). That part
 * is drawn with the rows, after the router has looked for it and found
 * nothing, so the page scrolls there itself once they are in. */
async function scrollToAnchor() {
  if (!route.hash) return;
  await nextTick();
  document
    .getElementById(route.hash.slice(1))
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
}

/** Bring the report a link points at into view, open: the rows arrive after
 * the router has already tried to scroll to it, a closed one is folded away -
 * and only the full list has the closed ones at all - and a filter may be
 * hiding it. */
async function focusTarget() {
  const id = hashTarget();
  missingTarget.value = false;
  if (!id) {
    await scrollToAnchor();
    return;
  }
  const item = items.value.find((entry) => entry.id === id);
  if (!item) {
    missingTarget.value = !pending.value && !loadError.value;
    return;
  }
  const isClosed = sectionOf(item) === "closed";
  // Replaced rather than pushed, and with the hash kept: the link is where
  // the reader went, the view and the filter are only in its way.
  const query = { ...route.query };
  if (isClosed) query.widok = "lista";
  if (!shows(item)) delete query.zrodlo;
  if (!sameQuery(query, route.query)) {
    await router.replace({ query, hash: route.hash });
  }
  if (isClosed) showClosed.value = true;
  openRows.add(id);
  // The open row has to exist, at its full height, before it is centred.
  await nextTick();
  document
    .getElementById(`fb-${id}`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// A link followed while the page is open can name a report that arrived after
// it loaded, or a closed one older than the list goes back - so look again
// before saying there is no such report. After the writes already made, as
// for the queue below.
watch(
  () => route.hash,
  async () => {
    const id = hashTarget();
    if (id && !items.value.some((e) => e.id === id)) {
      await writesSettled();
      await load();
    }
    await focusTarget();
  },
);

// Back to the queue from the full list, it starts from a fresh list: a rank
// is computed from the neighbours on screen, so they had better be the ones
// in the database. The list stays inert until they are. The first load is
// fresh already.
watch(queueView, async (toQueue) => {
  if (!toQueue) return;
  pending.value = true;
  await writesSettled();
  await load();
});

onMounted(async () => {
  await load();
  await focusTarget();
});
</script>

<template>
  <!-- One line per report, and each opens in place into the row of the full
       list, status and note included, so the queue is worked through here as
       well as ordered. -->
  <div ref="root" class="fb-order">
    <AdminSectionHead
      title="Kolejka"
      :count="queue.length"
      info="Od góry: co robimy najpierw. Kliknij zgłoszenie, żeby je rozwinąć, odpowiedzieć notatką albo zamknąć."
      data-section="queue"
    >
      <span class="text-caption text-medium-emphasis">
        Przeciągnij albo użyj strzałek.
      </span>
    </AdminSectionHead>

    <div
      v-if="queue.length === 0"
      class="fb-drop-empty text-body-2 text-medium-emphasis mb-6"
      :class="{ 'fb-drop-empty--active': hint?.id === EMPTY }"
      data-queue-empty
      @dragover="onDragOver($event, EMPTY)"
      @dragleave="onDragLeave(EMPTY)"
      @drop="onDropEmpty"
    >
      Kolejka jest pusta. Przeciągnij tu zgłoszenie albo kliknij przy nim +.
    </div>

    <AdminRowList v-else class="mb-6" data-queue-list>
      <!-- The row is its own drop target, open part and all; its line is
           what picks it up. The place is the row's index: the queue arrives
           whole. No `.prevent` on the drag events: whether one is the list's
           to take depends on whether a row is being dragged. -->
      <FeedbackReportRow
        v-for="(item, index) in queue"
        :key="item.id"
        v-bind="row(item)"
        :position="index + 1"
        draggable
        :class="rowClasses(item)"
        data-queue-row
        @dragstart="onDragStart($event, item)"
        @dragover="onDragOver($event, item.id!)"
        @dragleave="onDragLeave(item.id!)"
        @drop="onDropOnQueueRow($event, item)"
        @dragend="onDragEnd"
      >
        <template #actions>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="index === 0"
            aria-label="Wyżej"
            title="Wyżej"
            @click="step(item, -1)"
          >
            <v-icon :icon="mdiArrowUp" />
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="index === queue.length - 1"
            aria-label="Niżej"
            title="Niżej"
            @click="step(item, 1)"
          >
            <v-icon :icon="mdiArrowDown" />
          </v-btn>
          <!-- On the line, as "+" is on the lines under the queue: the way
               out was a menu entry, a click too far for anybody to find. -->
          <v-btn
            icon
            size="x-small"
            variant="text"
            aria-label="Wyjmij z kolejki"
            title="Wyjmij z kolejki"
            @click="emit('remove', item)"
          >
            <v-icon :icon="mdiPlaylistRemove" />
          </v-btn>
          <v-menu location="bottom end">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                icon
                size="x-small"
                variant="text"
                aria-label="Więcej"
                title="Więcej"
              >
                <v-icon :icon="mdiDotsVertical" />
              </v-btn>
            </template>
            <v-list density="compact">
              <v-list-item
                :disabled="index === 0"
                title="Na początek"
                @click="emit('move', item, 0)"
              />
              <v-list-item
                :disabled="index === queue.length - 1"
                title="Na koniec"
                @click="emit('move', item, queue.length - 1)"
              />
            </v-list>
          </v-menu>
        </template>
      </FeedbackReportRow>
    </AdminRowList>

    <template v-if="inbox.length > 0">
      <!-- What the dashboard's "Przejdź do zgłoszeń" counts, so where it
           lands. -->
      <AdminSectionHead
        :id="FEEDBACK_INBOX_ANCHOR"
        class="fb-anchor"
        title="Poza kolejką"
        :count="inbox.length"
        info="Jeszcze bez miejsca w kolejce, od najnowszych. + dopisuje zgłoszenie na koniec kolejki."
        data-section="inbox"
      />
      <!-- Dropping a queued report anywhere here takes it out of the queue,
           the same as "Wyjmij z kolejki". -->
      <AdminRowList
        :class="{ 'fb-list--target': hint?.id === INBOX }"
        data-inbox-list
        @dragover="onDragOverInbox"
        @dragleave="onDragLeave(INBOX)"
        @drop="onDropOnInbox"
      >
        <FeedbackReportRow
          v-for="item in inbox"
          :key="item.id"
          v-bind="row(item)"
          draggable
          :class="{ 'fb-row--dragging': draggingId === item.id }"
          data-inbox-row
          @dragstart="onDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <template #actions>
            <v-btn
              icon
              size="x-small"
              variant="text"
              color="ink-sage"
              aria-label="Dodaj na koniec kolejki"
              title="Dodaj na koniec kolejki"
              @click="emit('move', item, queue.length)"
            >
              <v-icon :icon="mdiPlus" />
            </v-btn>
            <v-btn
              icon
              size="x-small"
              variant="text"
              aria-label="Na początek kolejki"
              title="Na początek kolejki"
              @click="emit('move', item, 0)"
            >
              <v-icon :icon="mdiArrowCollapseUp" />
            </v-btn>
          </template>
        </FeedbackReportRow>
      </AdminRowList>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  mdiArrowCollapseUp,
  mdiArrowDown,
  mdiArrowUp,
  mdiDotsVertical,
  mdiPlaylistRemove,
  mdiPlus,
} from "@mdi/js";
import type FeedbackReportRow from "./ReportRow.vue";
import { FEEDBACK_INBOX_ANCHOR } from "~/composables/feedback";
import type { Feedback } from "~~/shared/model";

type ReportRowProps = InstanceType<typeof FeedbackReportRow>["$props"];

const props = defineProps<{
  /** Queued open reports, in queue order. */
  queue: Feedback[];
  /** Open reports nobody has put in the queue yet, newest first. */
  inbox: Feedback[];
  /** Everything else a report's row takes - its fix, its status and note and
   * their saves, whether it is open - from the page, which wires the rows of
   * its full list the same way. A report opened here is that row, not a copy
   * of it. */
  row: (item: Feedback) => ReportRowProps;
}>();

/** `index` is the slot among the queue *without* the moved report - "third"
 * means third whichever way the report came from. The page turns it into a
 * rank with `rankForSlot`. */
const emit = defineEmits<{
  move: [item: Feedback, index: number];
  remove: [item: Feedback];
}>();

const root = ref<HTMLElement | null>(null);

/** How soon a second click on an arrow counts as "further" - see `step`. */
const REPEAT_MS = 800;
/** The last arrow move: which report, which way, when, and the slot it left -
 * the one its neighbour slid into. */
let lastStep: {
  id: string;
  direction: -1 | 1;
  at: number;
  vacated: number;
} | null = null;

/** One place up or down, from an arrow.
 *
 * Rows are one line high, so the row a click moved slides out from under the
 * pointer and its neighbour - with the same arrow in the same place - slides
 * in. A quick second click on that neighbour, in the slot the moved report
 * left, means "further", not "put the neighbour back", so it goes to the
 * report that just moved. A click anywhere else is taken as meant. Focus
 * follows the moved report too: re-rendering the list moves its row, and a
 * moved node drops focus. */
async function step(item: Feedback, direction: -1 | 1) {
  const now = performance.now();
  const repeat =
    lastStep &&
    lastStep.direction === direction &&
    lastStep.id !== item.id &&
    now - lastStep.at < REPEAT_MS &&
    props.queue.findIndex((entry) => entry.id === item.id) === lastStep.vacated
      ? props.queue.find((entry) => entry.id === lastStep!.id)
      : undefined;
  const target = repeat ?? item;
  const at = props.queue.findIndex((entry) => entry.id === target.id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= props.queue.length) return;

  lastStep = { id: target.id!, direction, at: now, vacated: at };
  emit("move", target, to);

  await nextTick();
  const row = root.value?.querySelector<HTMLElement>(
    `[data-queue-row][data-feedback-id="${CSS.escape(target.id!)}"]`,
  );
  // At the end of the queue that arrow is disabled. Not the other one then:
  // the next Enter would carry the report straight back. "Więcej" moves
  // nothing on Enter.
  const label = direction < 0 ? "Wyżej" : "Niżej";
  (
    row?.querySelector<HTMLElement>(
      `button[aria-label="${label}"]:not([disabled])`,
    ) ?? row?.querySelector<HTMLElement>('button[aria-label="Więcej"]')
  )?.focus();
}

/** Drop targets that are not a row. */
const EMPTY = "__empty__";
const INBOX = "__inbox__";

/** Native drag and drop, with no library: the arrows and the menu are the way
 * to do the same thing from a keyboard or a phone, so this only has to cover a
 * mouse. The list never reorders while a row is dragged - only on drop - so
 * what is under the pointer is always what was there when the drag began. */
const draggingId = ref<string | null>(null);
const hint = ref<{ id: string; after: boolean } | null>(null);

const dragged = () =>
  [...props.queue, ...props.inbox].find((item) => item.id === draggingId.value);

/** A row is picked up by its own line only. The open part has links, chips
 * and text to select, and a drag of any of them - a link pulled into another
 * tab, say - bubbles up to the row as a dragstart too: taken for the row,
 * letting it go over another one would move the report. That drag is the
 * browser's, and the list stays out of it. A drag of selected text can start
 * on a text node, so the element is looked up from the node. */
function onDragStart(event: DragEvent, item: Feedback) {
  const from =
    event.target instanceof Element
      ? event.target
      : ((event.target as Node | null)?.parentElement ?? null);
  const head = from?.closest(".arow__head");
  if (!head || head.parentElement !== event.currentTarget) return;
  draggingId.value = item.id ?? null;
  if (event.dataTransfer) {
    // Firefox starts no drag at all without some data set.
    event.dataTransfer.setData("text/plain", item.id ?? "");
    event.dataTransfer.effectAllowed = "move";
  }
}

/** Taken only while a row is dragged. Cancelling a dragover is how a page
 * says "drop here", and said for anything else - some text dragged across an
 * open row - it would take a drop meant for that row's note. */
function onDragOver(event: DragEvent, id: string) {
  if (!draggingId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const target = event.currentTarget as HTMLElement | null;
  const rect = target?.getBoundingClientRect();
  const after = rect ? event.clientY > rect.top + rect.height / 2 : false;
  if (hint.value?.id !== id || hint.value.after !== after) {
    hint.value = { id, after };
  }
}

/** Only a queued report can be dropped on the inbox - that takes it out of the
 * queue. The inbox has no order of its own, so a report from there has
 * nothing to do here, and the list should not light up as if it had. */
function onDragOverInbox(event: DragEvent) {
  if (!props.queue.some((entry) => entry.id === draggingId.value)) return;
  onDragOver(event, INBOX);
}

function onDragLeave(id: string) {
  if (hint.value?.id === id) hint.value = null;
}

function onDragEnd() {
  draggingId.value = null;
  hint.value = null;
}

/** A drop, like a dragover, is the list's only while a row is dragged: text
 * let go over an open row's note goes into the note. A row let go there is
 * still a move, and its id stays out of the note. */
function onDropOnQueueRow(event: DragEvent, target: Feedback) {
  if (!draggingId.value) return;
  event.preventDefault();
  const item = dragged();
  const over = hint.value;
  const after = !!over && over.id === target.id && over.after;
  onDragEnd();
  if (!item || item.id === target.id) return;

  const others = props.queue.filter((entry) => entry.id !== item.id);
  const at = others.findIndex((entry) => entry.id === target.id);
  if (at < 0) return;
  emit("move", item, after ? at + 1 : at);
}

function onDropEmpty(event: DragEvent) {
  if (!draggingId.value) return;
  event.preventDefault();
  const item = dragged();
  onDragEnd();
  if (item) emit("move", item, 0);
}

function onDropOnInbox(event: DragEvent) {
  if (!draggingId.value) return;
  event.preventDefault();
  const item = dragged();
  onDragEnd();
  if (item && props.queue.some((entry) => entry.id === item.id)) {
    emit("remove", item);
  }
}

const rowClasses = (item: Feedback) => {
  const over =
    hint.value?.id === item.id && draggingId.value !== item.id
      ? hint.value
      : null;
  return {
    "fb-row--dragging": draggingId.value === item.id,
    "fb-row--drop-before": !!over && !over.after,
    "fb-row--drop-after": !!over && over.after,
  };
};
</script>

<style scoped>
/* Clears the sticky toolbar when a link scrolls the heading into view, as a
 * row does (see `AdminExpandRow`). */
.fb-anchor {
  scroll-margin-top: 96px;
}

.fb-list--target {
  outline: 2px dashed rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}

.fb-row--dragging {
  opacity: 0.4;
}

/* The line a drop would land on, drawn inside the row so it moves nothing -
 * and beside the row's rail, which is an inset shadow as well. */
.fb-row--drop-before {
  box-shadow:
    inset 4px 0 0 rgb(var(--arow-ink)),
    inset 0 2px 0 rgb(var(--v-theme-ink-sage));
}

.fb-row--drop-after {
  box-shadow:
    inset 4px 0 0 rgb(var(--arow-ink)),
    inset 0 -2px 0 rgb(var(--v-theme-ink-sage));
}

.fb-drop-empty {
  border: 2px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  padding: 16px;
  text-align: center;
}

.fb-drop-empty--active {
  border-color: rgb(var(--v-theme-ink-sage));
}
</style>

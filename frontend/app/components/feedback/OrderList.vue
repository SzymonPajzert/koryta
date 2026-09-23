<template>
  <!-- One line per report and nothing to answer with: this is the mode for
       deciding what comes next, so the status, the note and the links stay on
       the cards of the other mode. -->
  <div ref="root" class="fb-order">
    <div class="d-flex align-center ga-2 mb-2">
      <h2 class="text-subtitle-1 font-weight-bold">Kolejka</h2>
      <v-chip size="x-small" label>{{ queue.length }}</v-chip>
      <span class="text-caption text-medium-emphasis ms-auto">
        Przeciągnij albo użyj strzałek.
      </span>
    </div>

    <div
      v-if="queue.length === 0"
      class="fb-drop-empty text-body-2 text-medium-emphasis mb-6"
      :class="{ 'fb-drop-empty--active': hint?.id === EMPTY }"
      data-queue-empty
      @dragover.prevent="onDragOver($event, EMPTY)"
      @dragleave="onDragLeave(EMPTY)"
      @drop.prevent="onDropEmpty"
    >
      Kolejka jest pusta. Przeciągnij tu zgłoszenie albo kliknij przy nim +.
    </div>

    <div v-else class="fb-list mb-6" data-queue-list>
      <div
        v-for="(item, index) in queue"
        :id="`fb-${item.id}`"
        :key="item.id"
        class="fb-row"
        :class="rowClasses(item)"
        draggable="true"
        data-queue-row
        :data-feedback-id="item.id"
        @dragstart="onDragStart($event, item)"
        @dragover.prevent="onDragOver($event, item.id!)"
        @dragleave="onDragLeave(item.id!)"
        @drop.prevent="onDropOnQueueRow(item)"
        @dragend="onDragEnd"
      >
        <v-icon :icon="mdiDragVertical" class="fb-handle" size="small" />
        <span class="fb-pos text-body-2 font-weight-bold"
          >{{ index + 1 }}.</span
        >
        <FeedbackOrderRowSummary :item="item" />
        <div class="fb-actions">
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
              <v-list-item
                title="Wyjmij z kolejki"
                @click="emit('remove', item)"
              />
            </v-list>
          </v-menu>
        </div>
      </div>
    </div>

    <template v-if="inbox.length > 0">
      <div class="d-flex align-center ga-2 mb-2">
        <h2 class="text-subtitle-1 font-weight-bold">Poza kolejką</h2>
        <v-chip size="x-small" label>{{ inbox.length }}</v-chip>
      </div>
      <!-- Dropping a queued report anywhere here takes it out of the queue,
           the same as "Wyjmij z kolejki". -->
      <div
        class="fb-list"
        :class="{ 'fb-list--target': hint?.id === INBOX }"
        data-inbox-list
        @dragover="onDragOverInbox"
        @dragleave="onDragLeave(INBOX)"
        @drop.prevent="onDropOnInbox"
      >
        <div
          v-for="item in inbox"
          :id="`fb-${item.id}`"
          :key="item.id"
          class="fb-row"
          :class="{ 'fb-row--dragging': draggingId === item.id }"
          draggable="true"
          data-inbox-row
          :data-feedback-id="item.id"
          @dragstart="onDragStart($event, item)"
          @dragend="onDragEnd"
        >
          <v-icon :icon="mdiDragVertical" class="fb-handle" size="small" />
          <FeedbackOrderRowSummary :item="item" />
          <div class="fb-actions">
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
          </div>
        </div>
      </div>
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
  mdiDragVertical,
  mdiPlus,
} from "@mdi/js";
import type { Feedback } from "~~/shared/model";

const props = defineProps<{
  /** Queued open reports, in queue order. */
  queue: Feedback[];
  /** Open reports nobody has put in the queue yet, newest first. */
  inbox: Feedback[];
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

function onDragStart(event: DragEvent, item: Feedback) {
  draggingId.value = item.id ?? null;
  if (event.dataTransfer) {
    // Firefox starts no drag at all without some data set.
    event.dataTransfer.setData("text/plain", item.id ?? "");
    event.dataTransfer.effectAllowed = "move";
  }
}

function onDragOver(event: DragEvent, id: string) {
  if (!draggingId.value) return;
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
  event.preventDefault();
  onDragOver(event, INBOX);
}

function onDragLeave(id: string) {
  if (hint.value?.id === id) hint.value = null;
}

function onDragEnd() {
  draggingId.value = null;
  hint.value = null;
}

function onDropOnQueueRow(target: Feedback) {
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

function onDropEmpty() {
  const item = dragged();
  onDragEnd();
  if (item) emit("move", item, 0);
}

function onDropOnInbox() {
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
.fb-list {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
}

.fb-list--target {
  outline: 2px dashed rgb(var(--v-theme-ink-sage));
  outline-offset: 2px;
}

.fb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 2px 4px 2px 8px;
  background: rgb(var(--v-theme-surface));
  cursor: grab;
}

.fb-row + .fb-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.fb-row--dragging {
  opacity: 0.4;
}

/* The line a drop would land on, drawn inside the row so it moves nothing. */
.fb-row--drop-before {
  box-shadow: inset 0 2px 0 rgb(var(--v-theme-ink-sage));
}

.fb-row--drop-after {
  box-shadow: inset 0 -2px 0 rgb(var(--v-theme-ink-sage));
}

.fb-handle {
  flex: none;
  opacity: 0.6;
}

.fb-pos {
  flex: none;
  min-width: 2ch;
  text-align: end;
}

.fb-actions {
  flex: none;
  display: flex;
  align-items: center;
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

/* On a phone the buttons leave the text a dozen characters, and a tooltip is
 * no help without a pointer - so the text gets a line of its own, under the
 * handle and the buttons (see `OrderRowSummary`). */
@media (max-width: 599.98px) {
  .fb-row {
    flex-wrap: wrap;
    row-gap: 0;
  }

  .fb-actions {
    margin-inline-start: auto;
  }
}
</style>

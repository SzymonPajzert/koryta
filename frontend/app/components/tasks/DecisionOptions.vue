<template>
  <section
    class="task-options"
    :class="{ 'task-options--picked': !!task.picked }"
    data-task-options
  >
    <div class="task-options__head">
      <span class="task-options__label">
        {{ task.picked ? "Wybrano" : "Wybierz" }}
      </span>
      <span v-if="task.picked" class="text-caption text-medium-emphasis">
        {{ formatTaskDate(task.picked.at) }} ·
        {{ taskActorLabel(task.picked.by) }}
      </span>
    </div>

    <!-- One click records the answer. Each option says what it is in its
         own words, under the letter the body uses for it. -->
    <div class="task-options__list">
      <button
        v-for="option in task.options"
        :key="option.key"
        type="button"
        class="task-option"
        :class="{
          'task-option--picked': option.key === task.picked?.key,
          'task-option--recommended': option.key === task.recommended,
          'task-option--asked': option.key === asked,
        }"
        :aria-pressed="option.key === task.picked?.key"
        :disabled="saving"
        :data-task-option="option.key"
        @click="choose(option.key)"
      >
        <span class="task-option__key">{{ option.key }}</span>
        <span class="task-option__title">{{ option.title }}</span>
        <span
          v-if="option.key === task.recommended"
          class="task-option__mark"
          data-task-recommended
        >
          polecana
        </span>
        <v-icon
          v-if="option.key === task.picked?.key"
          class="task-option__tick"
          :icon="mdiCheck"
          size="18"
        />
      </button>
    </div>

    <!-- Changing an answer that work has already followed: say which work
         first, since it was done for the other one. -->
    <div v-if="asked" class="task-options__confirm" data-task-option-confirm>
      <span class="text-body-2">
        Według {{ task.picked?.key }} zrobiono już: {{ affectedText }}. Zmienić
        na {{ asked }}?
      </span>
      <v-btn
        size="small"
        variant="flat"
        color="ink-info"
        :disabled="saving"
        @click="confirm"
      >
        Zmień na {{ asked }}
      </v-btn>
      <v-btn size="small" variant="text" @click="asked = null">Anuluj</v-btn>
    </div>

    <!-- What follows from the answer: it closes the decision once done. -->
    <div v-if="task.picked" class="task-options__follow" data-task-follows>
      <p class="text-body-2 text-medium-emphasis mb-1">{{ followText }}</p>
      <ul v-if="follows.length > 0" class="task-options__follows">
        <li v-for="item in follows" :key="item.task.id">
          <button
            type="button"
            class="task-options__follow-link"
            @click="emit('select', item.task.id)"
          >
            <span
              class="task-options__dot"
              :class="`task-options__dot--${item.tone}`"
            />
            <span class="task-options__follow-title">{{ item.task.title }}</span>
            <span class="text-caption text-medium-emphasis">
              {{ item.word }}
            </span>
          </button>
        </li>
      </ul>
      <v-btn
        size="small"
        variant="text"
        class="mt-1"
        :disabled="saving"
        data-task-unpick
        @click="emit('pick', null)"
      >
        Cofnij wybór
      </v-btn>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiCheck } from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import {
  formatTaskDate,
  taskActorLabel,
  taskStatusConfig,
} from "~/utils/taskStyle";
import { isClosed, type Task, type TaskState } from "~~/shared/tasks";

/** A decision's answers as buttons, picked with one click. Once one is
 * picked the decision is in progress, and the tasks waiting on it - what
 * follows from the answer - are listed under it until they are closed. */
const props = defineProps<{
  task: Task;
  state: TaskState;
  saving?: boolean;
}>();

const emit = defineEmits<{
  /** The option picked, or null to take the pick back. */
  pick: [key: string | null];
  select: [id: string];
}>();

/** An answer asked for over one work has already followed, waiting for a
 * second click. */
const asked = ref<string | null>(null);

/** What waits on the decision, the closed ones last. */
const follows = computed(() =>
  [...props.state.dependents]
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)))
    .map((task) => ({
      task,
      tone: isClosed(task)
        ? "done"
        : task.status === "doing"
          ? "doing"
          : "open",
      word: taskStatusConfig[task.status].title.toLowerCase(),
    })),
);

/** Work done or started on the strength of the current answer. */
const affected = computed(() =>
  props.state.dependents.filter(
    (t) => t.status === "done" || t.status === "doing",
  ),
);

const tasksWord = (n: number) =>
  polishCounting(n, "zadanie", "zadania", "zadań");

const affectedText = computed(() => tasksWord(affected.value.length));

const followText = computed(() => {
  const all = props.state.dependents.length;
  if (all === 0) {
    return "Nic z niej nie wynika na liście. Zamknij ją, gdy wybór będzie wykonany.";
  }
  const closed = props.state.dependents.filter(isClosed).length;
  // „Wynikają” with the plural, „wynika” with one and with the genitive.
  // That it closes itself after them is said behind the list's (i).
  const verb = tasksWord(all).endsWith("zadania") ? "Wynikają" : "Wynika";
  return `${verb} z niej ${tasksWord(all)}, zamknięte ${closed}.`;
});

function choose(key: string) {
  const current = props.task.picked?.key;
  if (key === current) return;
  if (current && affected.value.length > 0) {
    asked.value = key;
    return;
  }
  emit("pick", key);
}

function confirm() {
  if (asked.value) emit("pick", asked.value);
  asked.value = null;
}
</script>

<style scoped>
.task-options {
  margin-bottom: 16px;
}

.task-options__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.task-options__label {
  font-size: 0.875rem;
  font-weight: 600;
}

.task-options__list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}

/* A whole answer is the button: a letter, its words, and the agent's
 * recommendation at the end. */
.task-option {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 10px;
  width: 100%;
  padding: 8px 12px 8px 8px;
  border: 1px solid rgba(var(--v-border-color), 0.22);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.task-option:hover {
  border-color: rgba(var(--v-border-color), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.task-option:active {
  transform: scale(0.99);
}

.task-option:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-info));
  outline-offset: 1px;
}

/* Saving a pick: every answer waits, visibly, until the server answers. */
.task-option:disabled {
  cursor: progress;
  opacity: 0.6;
}

.task-option__key {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--v-theme-ink-neutral));
  background: rgb(var(--v-theme-surface-muted));
}

.task-option__title {
  padding-top: 2px;
  font-size: 0.875rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.task-option__mark {
  align-self: center;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.25rem;
  white-space: nowrap;
  color: rgb(var(--v-theme-ink-sage));
  background: rgb(var(--v-theme-surface-sage));
}

/* The agent's pick, before any is made: its letter in the sage fill. */
.task-option--recommended .task-option__key {
  color: rgb(var(--v-theme-ink-sage));
  background: rgb(var(--v-theme-surface-sage));
}

/* The answer given. The others stay clickable, quieter, for a change of
 * mind. */
.task-option--picked {
  grid-template-columns: 24px minmax(0, 1fr) auto auto;
  border-color: rgb(var(--v-theme-ink-info));
  background: rgb(var(--v-theme-surface-info));
}

.task-option--picked .task-option__key {
  color: rgb(var(--v-theme-on-ink-info));
  background: rgb(var(--v-theme-ink-info));
}

.task-option--picked:hover {
  border-color: rgb(var(--v-theme-ink-info));
  background: rgb(var(--v-theme-surface-info));
}

.task-option__tick {
  align-self: center;
  color: rgb(var(--v-theme-ink-info));
}

/* On a phone the mark goes under the words, which keep the width. */
@media (max-width: 599.98px) {
  .task-option__mark {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
    margin-top: 4px;
  }
}

.task-options--picked .task-option:not(.task-option--picked) {
  opacity: 0.7;
}

.task-options--picked .task-option:not(.task-option--picked):hover,
.task-option--asked {
  opacity: 1;
}

.task-option--asked {
  border-color: rgb(var(--v-theme-ink-info));
  border-style: dashed;
}

.task-options__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-info));
}

.task-options__confirm > span {
  flex: 1 1 240px;
}

.task-options__follow {
  margin-top: 10px;
}

/* One column no wider than the row, so a long title is cut, not the row. */
.task-options__follows {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-options__follow-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  text-align: start;
  cursor: pointer;
}

.task-options__follow-link:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.task-options__follow-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-options__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px rgb(var(--v-theme-ink-neutral));
}

.task-options__dot--doing {
  box-shadow: none;
  background: rgb(var(--v-theme-ink-info));
}

.task-options__dot--done {
  box-shadow: none;
  background: rgb(var(--v-theme-ink-success));
}
</style>

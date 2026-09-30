<template>
  <div
    class="task-node"
    :class="[
      `task-node--${taskSectionConfig[section].tone}`,
      {
        'task-node--goal': task.kind === 'goal',
        'task-node--stacked': (stacked ?? 0) > 0,
        'task-node--selected': selected,
        'task-node--faded': faded,
      },
    ]"
    :style="{ width: `${TASK_NODE_WIDTH}px`, height: `${TASK_NODE_HEIGHT}px` }"
    :data-task-node="task.id"
    :title="task.title"
  >
    <!-- In on the left: what this waits on. Out on the right: what waits on
         it. Dragging from a right edge to a left one draws "this first, then
         that". -->
    <Handle
      type="target"
      :position="Position.Left"
      class="task-node__handle"
      :is-valid-connection="validConnection"
      :title="`${task.title} czeka na…`"
    />
    <div class="task-node__head">
      <v-icon size="x-small" :icon="taskKindConfig[task.kind].icon" />
      <!-- A goal says how far what leads to it has got, rather than what it
           waits on: it waits on all of it. -->
      <template v-if="progress">
        <span>{{ goalWord }}</span>
        <span v-if="progress.total > 0">
          · {{ progress.closed }}/{{ progress.total }}
        </span>
      </template>
      <template v-else>
        <span>{{ taskSectionConfig[section].short }}</span>
        <span v-if="task.status === 'doing'">· w toku</span>
        <span v-if="state.blockers.length > 0 && !stacked">
          · czeka na {{ state.blockers.length }}
        </span>
      </template>
      <span class="task-node__actions">
        <!-- Leaves on the map only this card and what it waits on, or brings
             the rest back. -->
        <button
          v-if="focused || focusable"
          type="button"
          class="task-node__focus nodrag nopan"
          :class="{ 'task-node__focus--on': focused }"
          :title="focusLabel"
          :aria-label="focusLabel"
          :aria-pressed="focused"
          data-task-focus
          @click.stop="focused ? emit('unfocus') : emit('focus')"
        >
          <v-icon
            size="14"
            :icon="
              focused
                ? mdiImageFilterCenterFocus
                : mdiImageFilterCenterFocusWeak
            "
          />
        </button>
        <!-- Folds the card together with everything that leads only to it,
             or spreads it out again. Buttons of their own, so that neither
             picks the card nor starts an arrow. -->
        <button
          v-if="stacked || foldable"
          type="button"
          class="task-node__fold nodrag nopan"
          :class="{ 'task-node__fold--stacked': stacked }"
          :title="foldLabel"
          :aria-label="foldLabel"
          data-task-fold
          @click.stop="stacked ? emit('unfold') : emit('fold')"
        >
          <span v-if="stacked">+{{ stacked }}</span>
          <v-icon
            size="14"
            :icon="stacked ? mdiArrowExpandLeft : mdiArrowCollapseRight"
          />
        </button>
      </span>
    </div>
    <div class="task-node__title">{{ task.title }}</div>
    <Handle
      type="source"
      :position="Position.Right"
      class="task-node__handle"
      :is-valid-connection="validConnection"
      :title="`Najpierw ${task.title}, potem…`"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Handle, Position, type ValidConnectionFunc } from "@vue-flow/core";
import {
  mdiArrowCollapseRight,
  mdiArrowExpandLeft,
  mdiImageFilterCenterFocus,
  mdiImageFilterCenterFocusWeak,
} from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import { TASK_NODE_HEIGHT, TASK_NODE_WIDTH } from "~/utils/taskGraph";
import { taskKindConfig, taskSectionConfig } from "~/utils/taskStyle";
import type { Task, TaskSection, TaskState } from "~~/shared/tasks";

/** A task's card on the map: its list's colour down the side, what it is,
 * whether it waits, and its title. A goal is a dark card instead: it is where
 * the arrows lead. */
const props = defineProps<{
  task: Task;
  state: TaskState;
  section: TaskSection;
  /** For a goal: of the tasks that lead to it, how many are closed. */
  progress?: { closed: number; total: number } | null;
  selected?: boolean;
  /** Shown only because it is joined to a task the filter kept, or because it
   * is on a focused map, which a filter only fades. */
  faded?: boolean;
  /** Whether an arrow being drawn onto one of this card's edges may land. */
  validConnection?: ValidConnectionFunc;
  /** How many tasks folding this card would hide. */
  foldable?: number;
  /** How many tasks are folded into it: it is drawn as a stack. */
  stacked?: number;
  /** Whether an arrow on the map leads into it, so that focusing on it would
   * leave something beside the card itself. */
  focusable?: boolean;
  /** The map shows only this task and what it waits on. */
  focused?: boolean;
}>();

const emit = defineEmits<{
  fold: [];
  unfold: [];
  focus: [];
  unfocus: [];
}>();

const tasksWord = (count: number) =>
  polishCounting(count, "zadanie", "zadania", "zadań");

const foldLabel = computed(() =>
  props.stacked
    ? `Rozwiń: ${tasksWord(props.stacked)} prowadzi tylko tutaj`
    : `Zwiń ${tasksWord(props.foldable ?? 0)}, które prowadzą tylko tutaj`,
);

const focusLabel = computed(() =>
  props.focused
    ? "Pokaż znów całą mapę"
    : "Pokaż tylko to zadanie i to, na co czeka",
);

const goalWord = computed(() =>
  props.task.status === "done"
    ? "Cel osiągnięty"
    : props.task.status === "dropped"
      ? "Cel porzucony"
      : props.task.status === "parked"
        ? "Cel odłożony"
        : "Cel",
);
</script>

<style>
.task-node {
  --task-ink: var(--v-theme-ink-neutral);
  --task-surface: var(--v-theme-surface-muted);
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 8px 14px;
  border: 1px solid rgba(var(--v-border-color), 0.2);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: inset 4px 0 0 rgb(var(--task-ink));
  cursor: pointer;
  /* No overflow clipping: the handles sit half outside the card. */
}

.task-node--warning {
  --task-ink: var(--v-theme-ink-warning);
  --task-surface: var(--v-theme-surface-warning);
}
.task-node--info {
  --task-ink: var(--v-theme-ink-info);
  --task-surface: var(--v-theme-surface-info);
}
.task-node--sage {
  --task-ink: var(--v-theme-ink-sage);
  --task-surface: var(--v-theme-surface-sage);
}
.task-node--success {
  --task-ink: var(--v-theme-ink-success);
  --task-surface: var(--v-theme-surface-success);
  opacity: 0.6;
}

.task-node--faded {
  opacity: 0.45;
}

/* A goal: the one dark card, so that where the chains lead is what the eye
 * finds first. Its colour is kept for the handles and the outline. */
.task-node--goal {
  --task-ink: var(--v-theme-ink-strong);
  border-color: rgb(var(--v-theme-ink-strong));
  background: rgb(var(--v-theme-ink-strong));
  box-shadow: none;
}

.task-node--goal .task-node__head,
.task-node--goal .task-node__title {
  color: rgb(var(--v-theme-on-ink-strong));
}

.task-node--goal .task-node__title {
  font-weight: 600;
}

.task-node--goal.task-node:hover,
.task-node--goal.task-node--selected {
  background: rgb(var(--v-theme-ink-neutral));
}

.task-node:hover,
.task-node--selected {
  background: rgb(var(--task-surface));
}

/* A folded card: two more cards behind it, up and to the right, for the
 * tasks it stands for. Behind the card's own background, since the card
 * makes no stacking context of its own and the node around it does. */
.task-node--stacked::before,
.task-node--stacked::after {
  content: "";
  position: absolute;
  inset: -1px;
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: inherit;
  background: rgb(var(--v-theme-surface));
  pointer-events: none;
}

.task-node--stacked::before {
  transform: translate(5px, -5px);
  z-index: -1;
}

.task-node--stacked::after {
  transform: translate(10px, -10px);
  z-index: -2;
}

.task-node--goal.task-node--stacked::before,
.task-node--goal.task-node--stacked::after {
  border-color: rgb(var(--v-theme-surface));
  background: rgb(var(--v-theme-ink-strong));
}

.task-node--selected {
  outline: 2px solid rgb(var(--task-ink));
  outline-offset: 1px;
}

.task-node__head {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--task-ink));
  white-space: nowrap;
}

.task-node__actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-inline-start: auto;
}

.task-node__fold,
.task-node__focus {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border-radius: 4px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* Hidden until wanted, except on a stack, where it says how many there are,
 * and on the card the map is focused on, where it is the way back. */
.task-node:hover .task-node__fold,
.task-node:hover .task-node__focus,
.task-node--selected .task-node__fold,
.task-node--selected .task-node__focus,
.task-node__fold:focus-visible,
.task-node__focus:focus-visible,
.task-node__fold--stacked,
.task-node__focus--on {
  opacity: 1;
}

.task-node__fold:hover,
.task-node__focus:hover,
.task-node__focus--on {
  background: rgba(var(--task-ink), 0.12);
}

.task-node--goal .task-node__fold:hover,
.task-node--goal .task-node__focus:hover,
.task-node--goal .task-node__focus--on {
  background: rgba(var(--v-theme-on-ink-strong), 0.2);
}

.task-node__title {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.8125rem;
  line-height: 1.3;
  color: rgb(var(--v-theme-on-surface));
}

/* Big enough to hit with a thumb, and only loud when it matters. */
.task-node .task-node__handle {
  width: 14px;
  height: 14px;
  border: 2px solid rgb(var(--v-theme-surface));
  background: rgb(var(--task-ink));
  opacity: 0.35;
  transition: opacity 0.15s ease;
}

.task-node:hover .task-node__handle,
.task-node--selected .task-node__handle,
.vue-flow__handle.connecting,
.vue-flow__handle.valid {
  opacity: 1;
}
</style>

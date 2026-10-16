<template>
  <span
    v-if="badge"
    class="task-priority"
    :class="[
      `task-priority--${badge.level}`,
      {
        'task-priority--taken': badge.taken,
        'task-priority--compact': compact,
      },
    ]"
    :title="badge.title"
    :data-task-priority="badge.taken ? `${badge.level}-taken` : badge.level"
  >
    <template v-if="compact">{{ badge.short }}</template>
    <!-- On a phone a sign alone, which keeps the row's second line - this
         badge, „W toku”, „czeka na”, „blokuje” and the date - to one line:
         the words are there for a screen reader. -->
    <template v-else>
      <v-icon class="d-sm-none" :icon="SIGNS[badge.level]" size="12" />
      <span class="d-sm-none d-sr-only">{{ badge.text }}</span>
      <span class="d-none d-sm-inline">{{ badge.text }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiArrowUpThick, mdiExclamationThick } from "@mdi/js";
import { taskPriorityBadge } from "~/utils/taskStyle";
import type { Task, TaskPriority, TaskState } from "~~/shared/tasks";

/** A level as a sign, where there is no room for its word. */
const SIGNS: Record<TaskPriority, string> = {
  urgent: mdiExclamationThick,
  high: mdiArrowUpThick,
};

/** A task's priority as a pill: filled for a level of its own, outlined for
 * one it takes from what it holds up. Nothing for a normal task. */
const props = defineProps<{
  task: Task;
  state: Pick<TaskState, "priority" | "priorityFrom">;
  /** The level alone, sized for a map card. */
  compact?: boolean;
}>();

const badge = computed(() => taskPriorityBadge(props.task, props.state));
</script>

<style scoped>
.task-priority {
  --task-priority-ink: var(--v-theme-ink-danger);
  --task-priority-on-ink: var(--v-theme-on-ink-danger);
  flex: none;
  padding: 0 6px;
  border-radius: var(--k-r-control);
  font-size: var(--k-meta-size);
  font-weight: 600;
  line-height: 1.25rem;
  white-space: nowrap;
  color: rgb(var(--task-priority-on-ink));
  background: rgb(var(--task-priority-ink));
}

.task-priority--high {
  --task-priority-ink: var(--v-theme-ink-warning);
  --task-priority-on-ink: var(--v-theme-on-ink-warning);
}

/* Taken from what it holds up: the same hue, outlined. On a white ground
 * rather than none, so that it reads on a goal's dark card too. */
.task-priority--taken {
  color: rgb(var(--task-priority-ink));
  background: rgb(var(--v-theme-surface));
  box-shadow: inset 0 0 0 1px rgb(var(--task-priority-ink));
}

@media (max-width: 599.98px) {
  .task-priority:not(.task-priority--compact) {
    padding: 0 3px;
  }
}

/* On a map card's top edge: the size of the card's head, the type system's
 * 12px floor, on a shorter line than in a row. */
.task-priority--compact {
  padding: 0 5px;
  line-height: 1rem;
}
</style>

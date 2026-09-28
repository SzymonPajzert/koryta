<template>
  <div
    class="task-node"
    :class="[
      `task-node--${taskSectionConfig[section].tone}`,
      { 'task-node--selected': selected, 'task-node--faded': faded },
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
      <span>{{ taskSectionConfig[section].short }}</span>
      <span v-if="task.status === 'doing'">· w toku</span>
      <span v-if="state.blockers.length > 0">
        · czeka na {{ state.blockers.length }}
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
import { Handle, Position, type ValidConnectionFunc } from "@vue-flow/core";
import { TASK_NODE_HEIGHT, TASK_NODE_WIDTH } from "~/utils/taskGraph";
import { taskKindConfig, taskSectionConfig } from "~/utils/taskStyle";
import type { Task, TaskSection, TaskState } from "~~/shared/tasks";

/** A task's card on the map: its list's colour down the side, what it is,
 * whether it waits, and its title. */
defineProps<{
  task: Task;
  state: TaskState;
  section: TaskSection;
  selected?: boolean;
  /** Shown only because it is joined to a task the filter kept. */
  faded?: boolean;
  /** Whether an arrow being drawn onto one of this card's edges may land. */
  validConnection?: ValidConnectionFunc;
}>();
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

.task-node:hover,
.task-node--selected {
  background: rgb(var(--task-surface));
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

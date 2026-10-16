<template>
  <div
    class="task-bar"
    :class="{ 'task-bar--dragging': dragging }"
    data-task-bar
  >
    <div class="task-bar__marks">
      <button
        v-for="mark in marks"
        :key="mark.id"
        type="button"
        class="task-bar__mark"
        :class="[
          `task-bar__mark--${mark.kind}`,
          {
            'task-bar__mark--stacked': mark.stacked,
            'task-bar__mark--closed': mark.closed,
            'task-bar__mark--drop': drop?.id === mark.id && drop.valid,
            'task-bar__mark--refused': drop?.id === mark.id && !drop.valid,
          },
        ]"
        :title="mark.title"
        :data-task-mark="mark.id"
        @click="emit('pick', mark.id)"
      >
        <v-icon
          size="14"
          :icon="
            mark.kind === 'goal'
              ? taskKindConfig.goal.icon
              : mdiCardMultipleOutline
          "
        />
        <span class="task-bar__title">{{ mark.title }}</span>
        <span class="task-bar__count">{{ mark.count }}</span>
      </button>
      <span v-if="marks.length === 0" class="task-bar__hint">
        Tu będą cele i zwinięte zadania - strzałkę można upuścić na nie z
        każdego miejsca mapy.
      </span>
    </div>
    <div class="task-bar__actions">
      <!-- Each only while there is something for it to do. -->
      <v-btn
        v-if="focused"
        size="small"
        variant="flat"
        :prepend-icon="mdiArrowExpandAll"
        :title="`Pokaż znów całą mapę, nie tylko „${focused}” i to, na co czeka`"
        data-task-unfocus
        @click="emit('unfocus')"
      >
        Cała mapa
      </v-btn>
      <v-btn
        v-if="canFoldAll"
        size="small"
        variant="flat"
        :prepend-icon="mdiArrowCollapseRight"
        data-task-fold-all
        @click="emit('fold-all')"
      >
        Zwiń wszystkie
      </v-btn>
      <v-btn
        v-if="canUnfoldAll"
        size="small"
        variant="flat"
        :prepend-icon="mdiArrowExpandLeft"
        data-task-unfold-all
        @click="emit('unfold-all')"
      >
        Rozwiń wszystkie
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  mdiArrowCollapseRight,
  mdiArrowExpandAll,
  mdiArrowExpandLeft,
  mdiCardMultipleOutline,
} from "@mdi/js";
import { taskKindConfig } from "~/utils/taskStyle";

/** What floats over the top of the map: the goals and the folded cards, so
 * that an arrow can be drawn to one of them from anywhere on the map without
 * finding it first - drop it on the name here - and a click brings it into
 * view. Beside them, folding every chain into the task it ends in, or
 * spreading all of it out again, and the way back from a map focused on one
 * task. */

export type TaskMark = {
  id: string;
  title: string;
  kind: "goal" | "fold";
  /** A goal's progress, or how many tasks a fold hides. */
  count: string;
  /** Folded: drawn as a stack on the map. */
  stacked: boolean;
  closed: boolean;
};

defineProps<{
  marks: readonly TaskMark[];
  /** An arrow is being drawn: every mark is a place to drop it. */
  dragging?: boolean;
  /** The mark under the arrow's end, and whether it may land there. */
  drop?: { id: string; valid: boolean } | null;
  /** The title of the task the map is focused on, if it is. */
  focused?: string | null;
  canFoldAll?: boolean;
  canUnfoldAll?: boolean;
}>();

const emit = defineEmits<{
  pick: [id: string];
  unfocus: [];
  "fold-all": [];
  "unfold-all": [];
}>();
</script>

<style>
/* Floats over the map without a band of its own: only the marks and the
 * buttons take the pointer, and the map between them can still be dragged. */
.task-bar {
  position: absolute;
  inset-block-start: 8px;
  inset-inline: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  z-index: 5;
  pointer-events: none;
}

/* The buttons go under the marks when the map is too narrow for both. */
.task-bar__marks {
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  /* Two rows at most; more scroll. */
  max-height: 66px;
  overflow-y: auto;
  /* Room for the stack and the outline drawn round a mark. */
  padding: 4px 6px 4px 4px;
}

.task-bar__actions {
  flex: none;
  margin-inline-start: auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  pointer-events: auto;
}

.task-bar__mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  font-size: 0.8125rem;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  pointer-events: auto;
}

.task-bar__mark--goal {
  border-color: rgb(var(--v-theme-ink-strong));
  background: rgb(var(--v-theme-ink-strong));
  color: rgb(var(--v-theme-on-ink-strong));
  font-weight: 600;
}

/* The same stack as a folded card's, in small. */
.task-bar__mark--stacked {
  box-shadow:
    3px -3px 0 -1px rgb(var(--v-theme-surface)),
    3px -3px 0 0 rgba(var(--v-border-color), 0.4),
    0 1px 4px rgba(0, 0, 0, 0.12);
}

.task-bar__mark--goal.task-bar__mark--stacked {
  box-shadow:
    3px -3px 0 -1px rgb(var(--v-theme-ink-strong)),
    3px -3px 0 0 rgb(var(--v-theme-surface)),
    0 1px 4px rgba(0, 0, 0, 0.12);
}

.task-bar__mark--closed {
  opacity: 0.6;
}

.task-bar__mark:hover {
  background: rgb(var(--v-theme-surface-muted));
}

.task-bar__mark--goal:hover {
  background: rgb(var(--v-theme-ink-neutral));
}

.task-bar__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-bar__count {
  flex: none;
  font-size: 0.75rem;
  font-weight: 600;
  opacity: 0.8;
}

/* While an arrow is drawn, each mark shows it takes one; the one under the
 * arrow's end says whether it may land. */
.task-bar--dragging .task-bar__mark {
  outline: 1px dashed rgb(var(--v-theme-ink-neutral));
  outline-offset: 2px;
}

.task-bar--dragging .task-bar__mark--drop {
  outline: 2px solid rgb(var(--v-theme-ink-success));
}

.task-bar--dragging .task-bar__mark--refused {
  outline: 2px solid rgb(var(--v-theme-ink-danger));
  cursor: not-allowed;
}

.task-bar__hint {
  align-self: center;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(var(--v-theme-surface), 0.85);
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>

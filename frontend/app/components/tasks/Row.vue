<template>
  <AdminExpandRow
    v-model:expanded="expanded"
    :row-id="taskAnchor(task.id)"
    :tone="taskSectionConfig[section].tone"
    :dimmed="section === 'closed' || section === 'parked'"
    :highlighted="highlighted"
    :label="task.title"
    :data-task-id="task.id"
    data-task-row
  >
    <template #summary>
      <!-- One line from a phone's width up. On a phone the title keeps the
           first line to itself and the pills and the date go under it: a task
           that is under way, waits, holds something up and is urgent used to
           leave its title a word and an ellipsis. -->
      <span class="task-head">
        <v-icon
          class="arow-fixed"
          size="small"
          :icon="taskKindConfig[task.kind].icon"
          :color="`ink-${taskSectionConfig[section].tone}`"
          :title="taskKindConfig[task.kind].title"
        />
        <span class="arow-grow task-head__title">{{ task.title }}</span>
        <TasksPriorityBadge
          v-if="section !== 'closed'"
          :task="task"
          :state="state"
        />
        <span
          v-if="task.status === 'doing'"
          class="arow-tag bg-surface-info text-ink-info"
        >
          W toku
        </span>
        <!-- A goal waits on everything that leads to it; what it says instead
             is how far that has got. -->
        <span
          v-if="progress"
          class="arow-tag bg-surface-muted"
          :title="`Zamknięte ${progress.closed} z ${progress.total} zadań, które prowadzą do tego celu`"
          data-goal-progress
        >
          {{ progress.closed }}/{{ progress.total }}
        </span>
        <span
          v-else-if="state.blockers.length > 0"
          class="arow-tag bg-surface-muted"
          :title="state.blockers.map((t) => t.title).join('\n')"
        >
          czeka na {{ state.blockers.length }}
        </span>
        <span
          v-if="openDependents > 0"
          class="arow-tag bg-surface-warning text-ink-warning"
          :title="state.dependents.map((t) => t.title).join('\n')"
        >
          blokuje {{ openDependents }}
        </span>
        <!-- Not on a phone: the open row lists them. -->
        <span
          v-if="task.tags.length > 0"
          class="arow-side text-medium-emphasis text-body-2 d-none d-sm-inline"
        >
          {{ task.tags.map((tag) => `#${tag}`).join(" ") }}
        </span>
        <span
          v-if="when"
          class="arow-fixed text-caption text-medium-emphasis"
          :title="`${when.label} ${formatTaskDate(when.at)}`"
          data-task-when
        >
          {{ formatDaysAgo(when.at) }}
        </span>
      </span>
    </template>

    <!-- Closing is the one thing done without reading the rest: the line is
         usually all it takes to know whether it happened. -->
    <template v-if="section !== 'closed'" #actions>
      <v-btn
        icon
        size="small"
        variant="text"
        color="ink-sage"
        aria-label="Zrobione"
        title="Zrobione"
        :loading="saving"
        data-task-done
        @click="emit('update', { status: 'done' })"
      >
        <v-icon :icon="mdiCheck" />
      </v-btn>
    </template>

    <TasksDetails
      :task="task"
      :state="state"
      :tasks="tasks"
      :saving="saving"
      @update="(patch) => emit('update', patch)"
      @edit="emit('edit')"
      @select="(id) => emit('select', id)"
      @show-goal="emit('show-goal', task.id)"
      @connect="
        (prerequisite, dependent) => emit('connect', prerequisite, dependent)
      "
      @disconnect="
        (prerequisite, dependent) => emit('disconnect', prerequisite, dependent)
      "
    />
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiCheck } from "@mdi/js";
import { formatDaysAgo } from "~/utils/chartTheme";
import {
  formatTaskDate,
  taskKindConfig,
  taskSectionConfig,
} from "~/utils/taskStyle";
import {
  goalProgress,
  isClosed,
  taskAnchor,
  type Task,
  type TaskPatch,
  type TaskSection,
  type TaskState,
} from "~~/shared/tasks";

/** One task on a list of /admin/zadania: a line with what it waits on and
 * what waits on it, opening in place to the rest. */

const props = defineProps<{
  task: Task;
  state: TaskState;
  section: TaskSection;
  tasks: readonly Task[];
  saving?: boolean;
  highlighted?: boolean;
  /** How long ago the moment the list is sorted by was, at the end of the
   * line: when it was added, or closed. */
  when?: { at: string; label: string };
}>();

const emit = defineEmits<{
  update: [patch: TaskPatch];
  edit: [];
  select: [id: string];
  /** Show only what leads to this goal. */
  "show-goal": [id: string];
  connect: [prerequisite: string, dependent: string];
  disconnect: [prerequisite: string, dependent: string];
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

const progress = computed(() =>
  props.task.kind === "goal" ? goalProgress(props.tasks, props.task.id) : null,
);

/** What cannot start until this one closes. */
const openDependents = computed(
  () => props.state.dependents.filter((t) => !isClosed(t)).length,
);
</script>

<style scoped>
/* The summary line, beside the toggle's chevron: the same 8px gaps the
 * toggle puts between its own items. */
.task-head {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 599.98px) {
  .task-head {
    flex-wrap: wrap;
    row-gap: 2px;
  }

  /* The rest of the first line after the 20px icon and its gap, with a few
   * pixels to spare, so whatever follows the title starts the second. */
  .task-head__title {
    flex: 1 1 calc(100% - 32px);
  }
}
</style>

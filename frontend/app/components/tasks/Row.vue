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
      <v-icon
        class="arow-fixed"
        size="small"
        :icon="taskKindConfig[task.kind].icon"
        :color="`ink-${taskSectionConfig[section].tone}`"
        :title="taskKindConfig[task.kind].title"
      />
      <span class="arow-grow">{{ task.title }}</span>
      <span
        v-if="task.status === 'doing'"
        class="arow-tag bg-surface-info text-ink-info"
      >
        W toku
      </span>
      <span
        v-if="state.blockers.length > 0"
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
      <!-- Not on a phone, where the title needs every pixel of the line. -->
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
}>();

const expanded = defineModel<boolean>("expanded", { default: false });

/** What cannot start until this one closes. */
const openDependents = computed(
  () => props.state.dependents.filter((t) => !isClosed(t)).length,
);
</script>

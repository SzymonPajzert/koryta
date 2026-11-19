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
      <!-- A merge leads with its branch, and the title says what it brings.
           Not on a phone: the two would leave a word of each. -->
      <span
        v-if="task.kind === 'merge' && task.branches.length > 0"
        class="task-row__branch arow-side d-none d-sm-inline"
        :title="task.branches.join('\n')"
        data-task-branch
      >
        {{ task.branches[0]
        }}<template v-if="task.branches.length > 1">
          +{{ task.branches.length - 1 }}</template
        >
      </span>
      <span class="arow-grow d-none d-sm-inline">{{ lineTitle }}</span>
      <span class="arow-grow d-sm-none">{{ task.title }}</span>
      <TasksPriorityBadge
        v-if="section !== 'closed'"
        :task="task"
        :state="state"
      />
      <span
        v-if="task.picked && section !== 'closed'"
        class="arow-tag bg-surface-info text-ink-info"
        :title="pickedTitle"
        data-task-picked
      >
        Wybrano {{ task.picked.key }}
      </span>
      <span
        v-else-if="task.status === 'doing'"
        class="arow-tag bg-surface-info text-ink-info"
      >
        W toku
      </span>
      <!-- A decision that can be answered with a click says so. -->
      <span
        v-else-if="optionCount > 0 && section !== 'closed'"
        class="arow-tag bg-surface-muted"
        data-task-option-count
      >
        {{ optionWord }}
      </span>
      <span
        v-if="merge && section !== 'closed'"
        class="arow-tag"
        :class="`bg-surface-${merge.surface}`"
        :title="merge.title"
        data-task-merge-state
      >
        {{ merge.text }}
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
      <!-- An answered decision holds nothing up any more. -->
      <span
        v-if="openDependents > 0 && !isSettled(task)"
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
      map-button
      @update="(patch) => emit('update', patch)"
      @edit="emit('edit')"
      @select="(id) => emit('select', id)"
      @show-goal="emit('show-goal', task.id)"
      @show-on-map="emit('show-on-map', task.id)"
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
import { polishCounting } from "~/composables/polish";
import {
  formatTaskDate,
  mergeStateConfig,
  mergeTitle,
  taskKindConfig,
  taskSectionConfig,
} from "~/utils/taskStyle";
import {
  goalProgress,
  isClosed,
  isSettled,
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
  /** Open the map, centred on this task. */
  "show-on-map": [id: string];
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

const lineTitle = computed(() => mergeTitle(props.task));

const optionCount = computed(() =>
  props.task.kind === "decision" ? (props.task.options?.length ?? 0) : 0,
);
const optionWord = computed(() =>
  polishCounting(optionCount.value, "opcja", "opcje", "opcji"),
);
const pickedTitle = computed(() => {
  const key = props.task.picked?.key;
  return props.task.options?.find((o) => o.key === key)?.title ?? "";
});

/** What the last check of main found, as the line's tag: „na main”, how
 * much of the branch is there, or that it is gone. Nothing while none of it
 * is on main: that is every merge waiting, and a tag on each says nothing. */
const merge = computed(() => {
  const check = props.task.mergeCheck;
  if (props.task.kind !== "merge" || !check || check.state === "open") {
    return null;
  }
  const config = mergeStateConfig[check.state];
  const commits = check.branches.reduce((sum, b) => sum + b.commits, 0);
  const landed = check.branches.reduce((sum, b) => sum + b.landed, 0);
  const text =
    check.state === "partial" ? `${landed}/${commits} na main` : config.title;
  return {
    text,
    surface: config.surface,
    title: `Sprawdzone ${formatTaskDate(check.checkedAt)}`,
  };
});
</script>

<style scoped>
/* The branch as the identifier it is: the name to type, in a code face. */
.task-row__branch {
  padding: 0 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
  line-height: 1.25rem;
  background: rgb(var(--v-theme-surface-muted));
}
</style>

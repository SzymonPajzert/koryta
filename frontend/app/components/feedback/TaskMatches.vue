<template>
  <!-- Under the title of a task being made from a report: what is on the list
       already. Each opens in a new tab, so the form stays as it was typed. -->
  <div v-if="tasks.length > 0" class="task-matches mb-4" data-task-matches>
    <div class="text-caption text-medium-emphasis mb-1">
      Na liście jest już coś podobnego - zgłoszenie można podpiąć tam zamiast
      dodawać nowe zadanie.
    </div>
    <div
      v-for="task in tasks"
      :key="task.id"
      class="task-matches__row d-flex align-center ga-2"
      :data-task-match="task.id"
    >
      <v-icon
        size="small"
        class="flex-0-0"
        :icon="taskKindConfig[task.kind].icon"
        :title="taskKindConfig[task.kind].title"
      />
      <a
        :href="`/admin/zadania#${taskAnchor(task.id)}`"
        target="_blank"
        rel="noopener"
        class="task-matches__title text-body-2"
        :title="task.title"
      >
        {{ task.title }}
      </a>
      <span
        v-if="reportId && hasReport(task)"
        class="flex-0-0 text-caption text-medium-emphasis"
      >
        ma już to zgłoszenie
      </span>
      <v-btn
        v-else
        size="small"
        variant="text"
        color="ink-sage"
        class="flex-0-0"
        :loading="attaching === task.id"
        :disabled="attaching !== null"
        @click="attach(task)"
      >
        Podepnij tu
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { taskKindConfig } from "~/utils/taskStyle";
import { reportsOf } from "~~/shared/reportTasks";
import { taskAnchor, type Task } from "~~/shared/tasks";

/** Tasks on the owner's list that look like the one a report is about to
 * become, for the task dialog on /admin/opinie: the report's own first, then
 * the open ones `similarTasks` finds - the same check `task_add` makes agents
 * pass. "Podepnij tu" names the report on that task instead. */

const props = defineProps<{
  tasks: Task[];
  /** The report the task is being made from. */
  reportId?: string;
  /** Names the report on the task; resolves true once it is saved. */
  attachReport: (task: Task) => Promise<boolean>;
}>();

const hasReport = (task: Task) => reportsOf(task).includes(props.reportId!);

/** The task being written to, while it is. */
const attaching = ref<string | null>(null);

async function attach(task: Task) {
  attaching.value = task.id;
  try {
    await props.attachReport(task);
  } finally {
    attaching.value = null;
  }
}
</script>

<style scoped>
.task-matches__row {
  min-height: 32px;
}

.task-matches__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

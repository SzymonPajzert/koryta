<template>
  <div class="task-details" :data-task-details="task.id">
    <div class="task-facts">
      <div class="task-fact">
        <span class="task-fact__label">Rodzaj</span>
        {{ taskKindConfig[task.kind].title }}
      </div>
      <div class="task-fact">
        <span class="task-fact__label">Kto</span>
        {{ taskWhoConfig[task.who].title }}
      </div>
      <div class="task-fact">
        <span class="task-fact__label">Status</span>
        {{ taskStatusConfig[task.status].title }}
      </div>
      <div class="task-fact">
        <span class="task-fact__label">Dodane</span>
        <!-- A link to the task itself, to copy: the same #t-<id> the MCP
             tools hand out. -->
        <a
          :href="`#${taskAnchor(task.id)}`"
          class="task-details__permalink"
          title="Link do tego zadania"
        >
          {{ formatTaskDate(task.createdAt) }}
        </a>
        · {{ taskActorLabel(task.createdBy) }}
      </div>
      <div v-if="task.source" class="task-fact">
        <span class="task-fact__label">Skąd</span>
        {{ task.source }}
      </div>
    </div>

    <p v-if="task.body" class="task-details__body text-body-2 mb-3">
      <template v-for="(part, index) in linkify(task.body)" :key="index">
        <a v-if="part.href" :href="part.href" target="_blank" rel="noopener">{{
          part.text
        }}</a>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>

    <!-- What it waits on, editable where it is read: the autocomplete is how a
         dependency is drawn without the map, on a phone included. -->
    <v-autocomplete
      :model-value="task.dependsOn"
      :items="candidates"
      item-title="title"
      item-value="id"
      label="Czeka na"
      :hint="waitingHint"
      persistent-hint
      multiple
      chips
      closable-chips
      density="compact"
      variant="outlined"
      :disabled="saving"
      class="mb-2"
      data-task-depends-on
      @update:model-value="changeDependencies"
    >
      <template #chip="{ props: chip, item }">
        <v-chip
          v-bind="chip"
          size="small"
          label
          :color="blockerIds.has(item.value) ? 'ink-warning' : 'ink-success'"
          :prepend-icon="blockerIds.has(item.value) ? undefined : mdiCheck"
        />
      </template>
      <template #item="{ props: row, item }">
        <v-list-item v-bind="row" :subtitle="item.value" />
      </template>
    </v-autocomplete>

    <div
      v-if="state.dependents.length > 0"
      class="d-flex align-center flex-wrap ga-1 mb-3 text-body-2"
      data-task-dependents
    >
      <span class="text-medium-emphasis me-1">Blokuje:</span>
      <v-chip
        v-for="dependent in state.dependents"
        :key="dependent.id"
        size="small"
        label
        variant="outlined"
        class="task-details__chip"
        :title="dependent.title"
        @click="emit('select', dependent.id)"
      >
        <span class="text-truncate">{{ dependent.title }}</span>
      </v-chip>
    </div>

    <div
      v-if="
        task.links.length > 0 ||
        task.branches.length > 0 ||
        task.tags.length > 0
      "
      class="d-flex align-center flex-wrap ga-1 mb-3"
    >
      <v-chip
        v-for="tag in task.tags"
        :key="`tag-${tag}`"
        size="x-small"
        label
        variant="tonal"
      >
        #{{ tag }}
      </v-chip>
      <v-chip
        v-for="branch in task.branches"
        :key="`branch-${branch}`"
        size="x-small"
        label
        :prepend-icon="mdiSourceBranch"
        :href="`${REPO}/tree/${encodeURIComponent(branch)}`"
        target="_blank"
      >
        {{ branch }}
      </v-chip>
      <template v-for="link in task.links" :key="`link-${link}`">
        <v-chip
          v-if="/^https?:\/\//.test(link)"
          size="x-small"
          label
          :prepend-icon="mdiLinkVariant"
          :href="link"
          target="_blank"
        >
          {{ shortLink(link) }}
        </v-chip>
        <!-- A path on the dev box: nothing to open from here, but worth
             copying. -->
        <v-chip v-else size="x-small" label variant="outlined">
          {{ link }}
        </v-chip>
      </template>
    </div>

    <div class="d-flex align-start ga-2 mb-2">
      <v-text-field
        v-model="note"
        label="Dopisz do historii"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="saving"
        data-task-note
        @keydown.enter.prevent="saveNote"
      />
      <v-btn
        variant="tonal"
        :disabled="saving || !note.trim()"
        height="40"
        @click="saveNote"
      >
        Dopisz
      </v-btn>
    </div>

    <ol v-if="history.length > 0" class="task-history text-body-2">
      <li v-for="(entry, index) in history" :key="index">
        <span class="text-medium-emphasis">
          {{ formatTaskDate(entry.at) }} · {{ taskActorLabel(entry.by) }}:
        </span>
        {{ entry.text }}
      </li>
    </ol>
    <v-btn
      v-if="task.log.length > history.length"
      size="small"
      variant="text"
      @click="showAll = true"
    >
      Cała historia ({{ task.log.length }})
    </v-btn>

    <div class="task-details__footer">
      <v-btn
        v-for="action in actions"
        :key="action.status"
        size="small"
        :variant="action.primary ? 'flat' : 'outlined'"
        :color="action.primary ? 'ink-sage' : undefined"
        :disabled="saving"
        :data-task-action="action.status"
        @click="emit('update', { status: action.status })"
      >
        {{ action.title }}
      </v-btn>
      <v-spacer />
      <v-btn
        size="small"
        variant="text"
        :prepend-icon="mdiPencilOutline"
        :disabled="saving"
        @click="emit('edit')"
      >
        Edytuj
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  mdiCheck,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiSourceBranch,
} from "@mdi/js";
import {
  formatTaskDate,
  linkify,
  taskActorLabel,
  taskKindConfig,
  taskStatusConfig,
  taskWhoConfig,
} from "~/utils/taskStyle";
import {
  dependencyChange,
  isClosed,
  taskAnchor,
  type Task,
  type TaskPatch,
  type TaskState,
  type TaskStatus,
} from "~~/shared/tasks";

/** A task opened up: what it is, what it waits on and unblocks, its history,
 * and what can be done with it. Shown in a list row and beside the map. */

const REPO = "https://github.com/SzymonPajzert/koryta";

const props = defineProps<{
  task: Task;
  state: TaskState;
  /** Every task, for picking what this one waits on. */
  tasks: readonly Task[];
  saving?: boolean;
}>();

const emit = defineEmits<{
  update: [patch: TaskPatch];
  edit: [];
  /** Another task was clicked, to be opened instead. */
  select: [id: string];
}>();

const candidates = computed(() =>
  props.tasks
    .filter((t) => t.id !== props.task.id)
    // Closed ones stay pickable - a dependency on something done is a record
    // of the order things happened in - but after the open ones.
    .sort((a, b) => Number(isClosed(a)) - Number(isClosed(b)))
    .map((t) => ({ id: t.id, title: t.title })),
);

const blockerIds = computed(
  () => new Set(props.state.blockers.map((t) => t.id)),
);

const waitingHint = computed(() => {
  const open = props.state.blockers.length;
  if (props.task.dependsOn.length === 0) return "Nic - można zaczynać.";
  if (open === 0) return "Wszystko, na co czekało, jest zamknięte.";
  return `Jeszcze ${open} z ${props.task.dependsOn.length} otwarte.`;
});

const shortLink = (link: string) => {
  const fb = /#fb-(.+)$/.exec(link);
  if (fb) return `zgłoszenie ${fb[1]!.slice(0, 8)}`;
  try {
    const url = new URL(link);
    return url.host + (url.pathname.length > 1 ? url.pathname : "");
  } catch {
    return link;
  }
};

function changeDependencies(ids: string[]) {
  const change = dependencyChange(props.task.dependsOn, ids);
  if (Object.keys(change).length > 0) emit("update", change);
}

const note = ref("");
/** The note sent and not yet in the history. The field is cleared once the
 * history shows it, and keeps the text if the save fails, so nothing typed is
 * lost. */
const sent = ref<string | null>(null);
const saveNote = () => {
  const text = note.value.trim();
  if (!text) return;
  sent.value = text;
  emit("update", { note: text });
};
watch(
  () => props.task.log.at(-1)?.text,
  (latest) => {
    if (sent.value !== null && latest === sent.value) {
      if (note.value.trim() === sent.value) note.value = "";
      sent.value = null;
    }
  },
);

const showAll = ref(false);
/** Newest first; the last ten unless asked for the rest. */
const history = computed(() => {
  const newest = [...props.task.log].reverse();
  return showAll.value ? newest : newest.slice(0, 10);
});

const actions = computed(() => {
  const all: Record<TaskStatus, { title: string; primary?: boolean }> = {
    doing: { title: "Zaczynam" },
    done: { title: "Zrobione", primary: true },
    parked: { title: "Odłóż" },
    dropped: { title: "Porzuć" },
    open: { title: isClosed(props.task) ? "Otwórz ponownie" : "Wznów" },
  };
  const offered: Record<TaskStatus, TaskStatus[]> = {
    open: ["doing", "done", "parked", "dropped"],
    doing: ["done", "open", "dropped"],
    parked: ["open", "dropped"],
    done: ["open"],
    dropped: ["open"],
  };
  return offered[props.task.status].map((status) => ({
    status,
    ...all[status],
    // Back from "w toku" to the list is a step back, not a reopening.
    title:
      props.task.status === "doing" && status === "open"
        ? "Odstaw"
        : all[status].title,
  }));
});
</script>

<style scoped>
.task-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin-bottom: 12px;
  font-size: 0.875rem;
}

.task-fact__label {
  margin-inline-end: 4px;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* A title is long; a chip holding one must not stick out of the panel. */
.task-details__chip {
  max-width: 100%;
}

.task-details__permalink {
  color: inherit;
  text-decoration: underline dotted;
}

.task-details__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.task-history {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  display: grid;
  gap: 2px;
}

.task-details__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>

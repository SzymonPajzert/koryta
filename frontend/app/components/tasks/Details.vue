<template>
  <div class="task-details" :data-task-details="task.id">
    <!-- What can be done with it, first: a row is opened to act on it. -->
    <div class="task-details__actions" data-task-actions>
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
      <!-- Its own level, beside the status: the button says which it is,
           the menu changes it. What it takes from others is said below. -->
      <v-menu location="bottom start">
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            size="small"
            :variant="task.priority ? 'tonal' : 'text'"
            :color="ownColor"
            :prepend-icon="PRIORITY_ICONS[task.priority ?? 'normal']"
            :append-icon="mdiChevronDown"
            :disabled="saving"
            :title="setBy ? `Priorytet, ustawił ${setBy}` : 'Priorytet'"
            data-task-priority-menu
          >
            {{ taskPriorityConfig[task.priority ?? "normal"].title }}
          </v-btn>
        </template>
        <v-list density="compact" min-width="200" data-task-priority-list>
          <v-list-subheader>Priorytet</v-list-subheader>
          <v-list-item
            v-for="choice in PRIORITY_MENU"
            :key="choice"
            :title="taskPriorityConfig[choice].title"
            :prepend-icon="PRIORITY_ICONS[choice]"
            :active="(task.priority ?? 'normal') === choice"
            :data-task-priority-choice="choice"
            @click="setPriority(choice)"
          />
          <v-list-item
            v-if="setBy"
            :subtitle="`ustawił ${setBy}`"
            disabled
            data-task-priority-set-by
          />
        </v-list>
      </v-menu>
      <v-spacer />
      <!-- On a phone and beside the map the tools are their icons, so the
           status buttons keep a line of their own. Words through `text`: a
           default slot, even an empty one, would take the icon's place. -->
      <v-btn
        v-for="tool in tools"
        :key="tool.key"
        size="small"
        variant="text"
        :icon="iconsOnly ? tool.icon : undefined"
        :prepend-icon="iconsOnly ? undefined : tool.icon"
        :text="iconsOnly ? undefined : tool.title"
        :color="tool.color"
        :disabled="tool.disabled"
        :title="tool.hint ?? tool.title"
        :aria-label="tool.title"
        v-bind="{ [tool.data]: '' }"
        @click="tool.run"
      />
    </div>
    <!-- The browser would not hand the text to the clipboard: here it is to
         copy by hand, already selected. -->
    <v-textarea
      v-if="manualCopy"
      :model-value="manualCopy"
      label="Skopiuj ręcznie (Ctrl+C)"
      readonly
      auto-grow
      rows="4"
      max-rows="12"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-3"
      data-task-copy-text
      @focus="($event.target as HTMLTextAreaElement).select()"
    />

    <!-- A decision's answers right under them: picking one is what a
         decision is opened for. -->
    <TasksDecisionOptions
      v-if="task.kind === 'decision' && (task.options?.length ?? 0) > 0"
      :task="task"
      :state="state"
      :saving="saving"
      @pick="(key) => emit('update', { pick: key })"
      @select="(id) => emit('select', id)"
    />
    <!-- A merge's branch: where to read it, and how much is on main. -->
    <TasksMergeBranch v-if="task.kind === 'merge'" :task="task" />

    <div class="task-facts">
      <div class="task-fact">
        <span class="task-fact__label">Rodzaj</span>
        {{ taskKindConfig[task.kind].title }}
      </div>
      <!-- A goal is nobody's to do: whoever does what leads to it. -->
      <div v-if="!isGoal" class="task-fact">
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

    <!-- When what it holds up asks for more than its own level, what. -->
    <div
      v-if="state.priority && state.priorityFrom.length > 0"
      class="task-details__priority mb-3"
      data-task-priority-field
    >
      <div class="task-details__taken text-body-2" data-task-priority-from>
        {{ taskPriorityConfig[state.priority].title }}, bo czeka na
        {{ isGoal ? "niego" : "nie" }}:
        <v-chip
          v-for="source in state.priorityFrom"
          :key="source.id"
          size="small"
          label
          class="task-details__chip"
          :color="state.priority === 'urgent' ? 'ink-danger' : 'ink-warning'"
          :prepend-icon="
            source.kind === 'goal' ? taskKindConfig.goal.icon : undefined
          "
          :title="source.title"
          @click="emit('select', source.id)"
        >
          {{ source.title }}
        </v-chip>
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
      :label="isGoal ? 'Prowadzą do niego' : 'Czeka na'"
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
      <!-- A click on a chip opens that task; its cross takes it away. -->
      <template #chip="{ props: chip, item }">
        <v-chip
          v-bind="chip"
          size="small"
          label
          class="task-details__chip"
          :color="blockerIds.has(item.value) ? 'ink-warning' : 'ink-success'"
          :prepend-icon="blockerIds.has(item.value) ? undefined : mdiCheck"
          :title="item.title"
          @click.stop="emit('select', item.value)"
        />
      </template>
      <template #item="{ props: row, item }">
        <v-list-item v-bind="row" :subtitle="item.value" />
      </template>
    </v-autocomplete>

    <!-- And what waits on it, the other way round: a task picked here waits
         on this one from now on. -->
    <v-autocomplete
      :model-value="dependentIds"
      :items="candidates"
      item-title="title"
      item-value="id"
      label="Blokuje"
      :hint="blockingHint"
      persistent-hint
      multiple
      chips
      closable-chips
      density="compact"
      variant="outlined"
      class="mb-2"
      data-task-dependents
      @update:model-value="changeDependents"
    >
      <template #chip="{ props: chip, item }">
        <v-chip
          v-bind="chip"
          size="small"
          label
          class="task-details__chip"
          :color="waitingIds.has(item.value) ? 'ink-info' : 'ink-success'"
          :prepend-icon="
            goalIds.has(item.value)
              ? taskKindConfig.goal.icon
              : waitingIds.has(item.value)
                ? undefined
                : mdiCheck
          "
          :title="item.title"
          @click.stop="emit('select', item.value)"
        />
      </template>
      <template #item="{ props: row, item }">
        <v-list-item v-bind="row" :subtitle="item.value" />
      </template>
    </v-autocomplete>

    <div
      v-if="
        task.links.length > 0 ||
        (task.branches.length > 0 && task.kind !== 'merge') ||
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
        v-for="branch in task.kind === 'merge' ? [] : task.branches"
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

  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiArrowUpThick,
  mdiCheck,
  mdiChevronDown,
  mdiContentCopy,
  mdiExclamationThick,
  mdiFilterOutline,
  mdiFlagOutline,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiSitemapOutline,
  mdiSourceBranch,
} from "@mdi/js";
import {
  formatTaskDate,
  linkify,
  taskActorLabel,
  taskChoices,
  taskKindConfig,
  taskPriorityConfig,
  taskPriorityOrder,
  taskStatusConfig,
  taskWhoConfig,
} from "~/utils/taskStyle";
import {
  dependencyChange,
  goalProgress,
  isClosed,
  taskAnchor,
  type PriorityChoice,
  type Task,
  type TaskPatch,
  type TaskState,
  type TaskStatus,
} from "~~/shared/tasks";
import { taskContext } from "~~/shared/taskContext";

/** A task opened up: what it is, what it waits on and what waits on it -
 * both editable - its history, and what can be done with it. Shown in a list
 * row and beside the map. */

const REPO = "https://github.com/SzymonPajzert/koryta";

const props = defineProps<{
  task: Task;
  state: TaskState;
  /** Every task, for picking what this one waits on. */
  tasks: readonly Task[];
  saving?: boolean;
  /** Offer „Na mapie”: on the list, not beside the map. */
  mapButton?: boolean;
  /** In a narrow column (beside the map): the tools as icons. */
  compact?: boolean;
}>();

const emit = defineEmits<{
  update: [patch: TaskPatch];
  edit: [];
  /** Another task was clicked, to be opened instead. */
  select: [id: string];
  /** Show only what leads to this goal. */
  "show-goal": [];
  /** Open the map on this task. */
  "show-on-map": [];
  /** `dependent` waits on `prerequisite` from now on - picked under
   * „Blokuje”, where the task being changed is the other one. */
  connect: [prerequisite: string, dependent: string];
  disconnect: [prerequisite: string, dependent: string];
}>();

const isGoal = computed(() => props.task.kind === "goal");

const { xs } = useDisplay();
const iconsOnly = computed(() => xs.value || props.compact);

/** The buttons beside the status ones: where else to see the task, and what
 * to do with its text. */
const tools = computed(() => {
  const all: {
    key: string;
    title: string;
    icon: string;
    data: string;
    run: () => void;
    hint?: string;
    color?: string;
    disabled?: boolean;
  }[] = [];
  if (props.mapButton) {
    all.push({
      key: "map",
      title: "Na mapie",
      hint: "Pokaż to zadanie na mapie, pośrodku",
      icon: mdiSitemapOutline,
      data: "data-task-show-on-map",
      run: () => emit("show-on-map"),
    });
  }
  if (isGoal.value && props.task.dependsOn.length > 0) {
    all.push({
      key: "goal",
      title: "Pokaż jego zadania",
      icon: mdiFilterOutline,
      data: "data-task-show-goal",
      run: () => emit("show-goal"),
    });
  }
  all.push(
    {
      key: "edit",
      title: "Edytuj",
      icon: mdiPencilOutline,
      data: "data-task-edit",
      disabled: props.saving,
      run: () => emit("edit"),
    },
    {
      key: "copy",
      title: copied.value ? "Skopiowano" : "Kopiuj dla czatu",
      hint: "Zadanie z tym, skąd się wzięło - notatką w pamięci, sesją, zgłoszeniami - z zależnościami i historią, do wklejenia w rozmowie z agentem",
      icon: copied.value ? mdiCheck : mdiContentCopy,
      color: copied.value ? "ink-success" : undefined,
      data: "data-task-copy",
      run: () => void copyContext(),
    },
  );
  return all;
});

/** The picked level in its own colour; normal has none. */
const ownColor = computed(() =>
  props.task.priority === "urgent"
    ? "ink-danger"
    : props.task.priority === "high"
      ? "ink-warning"
      : undefined,
);

/** The levels as the menu lists them, the most pressing first, each with
 * the sign the rows use for it. */
const PRIORITY_MENU: PriorityChoice[] = [...taskPriorityOrder].reverse();
const PRIORITY_ICONS: Record<PriorityChoice, string> = {
  urgent: mdiExclamationThick,
  high: mdiArrowUpThick,
  normal: mdiFlagOutline,
};

const setPriority = (value: PriorityChoice) => {
  if (value !== (props.task.priority ?? "normal")) {
    emit("update", { priority: value });
  }
};

/** An agent that raised the level, named: the owner knows his own. */
const setBy = computed(() =>
  props.task.priority &&
  props.task.prioritySetBy &&
  props.task.prioritySetBy !== "owner"
    ? taskActorLabel(props.task.prioritySetBy)
    : null,
);

const candidates = computed(() =>
  taskChoices(props.tasks.filter((t) => t.id !== props.task.id)),
);

const blockerIds = computed(
  () => new Set(props.state.blockers.map((t) => t.id)),
);

const waitingHint = computed(() => {
  if (isGoal.value) {
    // Counted through the whole chain, not only the tasks named here: the
    // last step of a long chain would otherwise say the goal is one away.
    const { closed, total } = goalProgress(props.tasks, props.task.id);
    if (total === 0) return "Dodaj zadania, które prowadzą do tego celu.";
    return `Zamknięte ${closed} z ${total} zadań, które do niego prowadzą.`;
  }
  const open = props.state.blockers.length;
  if (props.task.dependsOn.length === 0) return "Nic - można zaczynać.";
  if (open === 0) return "Wszystko, na co czekało, jest zamknięte.";
  return `Jeszcze ${open} z ${props.task.dependsOn.length} otwarte.`;
});

const dependentIds = computed(() => props.state.dependents.map((t) => t.id));
/** What waits on it and has not been closed: it is still in their way. */
const waitingIds = computed(
  () =>
    new Set(
      props.state.dependents.filter((t) => !isClosed(t)).map((t) => t.id),
    ),
);
const goalIds = computed(
  () =>
    new Set(
      props.state.dependents.filter((t) => t.kind === "goal").map((t) => t.id),
    ),
);

const blockingHint = computed(() => {
  // Answered, it holds nothing up: what is listed here follows from it.
  if (props.task.kind === "decision" && props.task.picked) {
    return "Wybór zapadł: nic już na nią nie czeka.";
  }
  // „zadanie” is neuter and „cel” masculine: na nie, na niego.
  const it = isGoal.value ? "niego" : "nie";
  const all = props.state.dependents.length;
  if (all === 0) return `Nic na ${it} nie czeka.`;
  const open = waitingIds.value.size;
  if (open === 0) return `Wszystko, co na ${it} czekało, jest zamknięte.`;
  return `Czeka na ${it} ${open} z ${all}.`;
});

/** Picked under „Blokuje”: each task added waits on this one, each taken
 * away no longer does. Those are changes to the other tasks. */
function changeDependents(ids: string[]) {
  const before = dependentIds.value;
  for (const id of ids) {
    if (!before.includes(id)) emit("connect", props.task.id, id);
  }
  for (const id of before) {
    if (!ids.includes(id)) emit("disconnect", props.task.id, id);
  }
}

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

/** "Skopiowano" for a moment after a copy, so the click is seen to work. */
const copied = ref(false);
const manualCopy = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyContext() {
  const text = taskContext(props.task, props.tasks);
  try {
    // Inside the try: on an insecure origin `navigator.clipboard` is
    // undefined, and reading it throws rather than rejects.
    await navigator.clipboard.writeText(text);
    manualCopy.value = "";
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    manualCopy.value = text;
    await nextTick();
    document
      .querySelector<HTMLTextAreaElement>(
        `[data-task-details="${props.task.id}"] [data-task-copy-text] textarea`,
      )
      ?.focus();
  }
}

const showAll = ref(false);
/** Newest first; the last ten unless asked for the rest. */
const history = computed(() => {
  const newest = [...props.task.log].reverse();
  return showAll.value ? newest : newest.slice(0, 10);
});

const actions = computed(() => {
  const all: Record<TaskStatus, { title: string; primary?: boolean }> = {
    doing: { title: "Zaczynam" },
    done: { title: isGoal.value ? "Osiągnięty" : "Zrobione", primary: true },
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
  // Nobody works on a goal itself, so it is never started. An answered
  // decision is in progress because of its answer: „Cofnij wybór” is the
  // way back, not a status of its own.
  const answered = props.task.kind === "decision" && !!props.task.picked;
  const statuses = offered[props.task.status].filter(
    (status) =>
      !(isGoal.value && status === "doing") &&
      !(answered && status === "open"),
  );
  // A decision waiting for an answer is answered with its options, which
  // lead: „Zrobione” is then one more way out, not the main one.
  const choosing =
    props.task.kind === "decision" &&
    !props.task.picked &&
    (props.task.options?.length ?? 0) > 0;
  return statuses.map((status) => ({
    status,
    ...all[status],
    primary: all[status].primary && !choosing,
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

.task-details__priority {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

/* No wider than the panel, so a long title in a chip is cut short there. */
.task-details__taken {
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/* A click on a chip opens its task, so a field full of one long title would
 * leave nothing to click to add another: the chips stop short of the end,
 * and what is left there takes the click and the typing. */
.task-details :deep(.v-autocomplete__selection) {
  max-width: calc(100% - 56px);
}

.task-details :deep(.v-autocomplete .v-field:not(.v-field--focused) input) {
  min-width: 48px;
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

/* The status buttons and the tools, over everything else; ruled off from
 * the task below. */
.task-details__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

@media (max-width: 599.98px) {
  .task-details__actions {
    gap: 6px 4px;
  }
}
</style>

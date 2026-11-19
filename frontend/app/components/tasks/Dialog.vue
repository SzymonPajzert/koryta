<template>
  <v-dialog v-model="open" max-width="680" scrollable>
    <v-card data-task-dialog>
      <v-card-title>{{
        editing ? "Zmień zadanie" : "Nowe zadanie"
      }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="form.title"
          label="Co zrobić"
          placeholder="Wdróż indeksy po scaleniu umowy-ui"
          variant="outlined"
          density="comfortable"
          autofocus
          :counter="200"
          data-task-title
        />
        <v-textarea
          v-model="form.body"
          label="Szczegóły"
          hint="Po co, co dokładnie, jakie polecenia uruchomić."
          variant="outlined"
          density="comfortable"
          auto-grow
          rows="3"
          class="mb-2"
        />
        <div class="d-flex flex-wrap ga-4 mb-4">
          <div>
            <div class="text-caption text-medium-emphasis mb-1">Rodzaj</div>
            <v-btn-toggle
              v-model="form.kind"
              mandatory
              density="comfortable"
              variant="outlined"
              divided
            >
              <v-btn
                v-for="(config, kind) in taskKindConfig"
                :key="kind"
                :value="kind"
                :prepend-icon="config.icon"
                size="small"
              >
                {{ config.title }}
              </v-btn>
            </v-btn-toggle>
          </div>
          <div v-if="form.kind !== 'goal'">
            <div class="text-caption text-medium-emphasis mb-1">Kto</div>
            <v-btn-toggle
              v-model="form.who"
              mandatory
              density="comfortable"
              variant="outlined"
              divided
            >
              <v-btn
                v-for="(config, who) in taskWhoConfig"
                :key="who"
                :value="who"
                :prepend-icon="config.icon"
                size="small"
              >
                {{ config.title }}
              </v-btn>
            </v-btn-toggle>
          </div>
          <div>
            <div class="text-caption text-medium-emphasis mb-1">Priorytet</div>
            <v-btn-toggle
              v-model="form.priority"
              mandatory
              density="comfortable"
              variant="outlined"
              divided
              :color="
                form.priority === 'urgent'
                  ? 'ink-danger'
                  : form.priority === 'high'
                    ? 'ink-warning'
                    : undefined
              "
              data-task-priority-choice
            >
              <v-btn
                v-for="choice in taskPriorityOrder"
                :key="choice"
                :value="choice"
                size="small"
              >
                {{ taskPriorityConfig[choice].title }}
              </v-btn>
            </v-btn-toggle>
          </div>
        </div>
        <!-- A decision's answers, each under a letter; the star marks the
             one to recommend. -->
        <div
          v-if="form.kind === 'decision'"
          class="mb-4"
          data-task-options-editor
        >
          <v-text-field
            v-model="form.question"
            label="Pytanie"
            placeholder="Jak oznaczać noc z ostrzeżeniami?"
            variant="outlined"
            density="comfortable"
            :counter="300"
            data-task-question-field
          />
          <div class="text-caption text-medium-emphasis mb-1">Opcje</div>
          <div
            v-for="(option, index) in form.options"
            :key="option.key"
            class="d-flex align-center ga-2 mb-2"
          >
            <span class="task-dialog__key">{{ option.key }}</span>
            <v-text-field
              v-model="option.title"
              :placeholder="index === 0 ? 'Zostaw jak jest' : undefined"
              density="compact"
              variant="outlined"
              hide-details
              :data-task-option-title="option.key"
            />
            <v-btn
              icon
              size="small"
              variant="text"
              :color="form.recommended === option.key ? 'ink-sage' : undefined"
              :title="
                form.recommended === option.key
                  ? 'Polecana - kliknij, żeby odznaczyć'
                  : 'Oznacz jako polecaną'
              "
              :aria-pressed="form.recommended === option.key"
              @click="
                form.recommended =
                  form.recommended === option.key ? null : option.key
              "
            >
              <v-icon
                :icon="form.recommended === option.key ? mdiStar : mdiStarOutline"
              />
            </v-btn>
            <v-btn
              icon
              size="small"
              variant="text"
              title="Usuń opcję"
              @click="form.options.splice(index, 1)"
            >
              <v-icon :icon="mdiClose" />
            </v-btn>
          </div>
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="mdiPlus"
            :disabled="form.options.length >= 8"
            data-task-option-add
            @click="addOption"
          >
            Dodaj opcję
          </v-btn>
        </div>
        <v-autocomplete
          v-model="form.dependsOn"
          :items="candidates"
          item-title="title"
          item-value="id"
          :label="form.kind === 'goal' ? 'Prowadzą do niego' : 'Czeka na'"
          :hint="
            form.kind === 'goal'
              ? 'Zadania, które trzeba zrobić, żeby osiągnąć ten cel.'
              : undefined
          "
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
        />
        <v-combobox
          v-model="form.tags"
          label="Tagi"
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
        />
        <v-combobox
          v-model="form.links"
          label="Linki"
          hint="Adresy, linki do zgłoszeń (#fb-…), ścieżki plików."
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
        />
        <v-combobox
          v-model="form.branches"
          :label="form.kind === 'merge' ? 'Gałąź do scalenia' : 'Gałęzie'"
          :hint="
            form.kind === 'merge'
              ? 'Nazwa gałęzi na GitHubie.'
              : undefined
          "
          :persistent-hint="form.kind === 'merge'"
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
          data-task-branches
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Anuluj</v-btn>
        <v-btn
          color="ink-sage"
          variant="flat"
          :disabled="!form.title.trim() || missingBranch"
          :loading="saving"
          data-task-save
          @click="save"
        >
          {{ editing ? "Zapisz" : "Dodaj" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { mdiClose, mdiPlus, mdiStar, mdiStarOutline } from "@mdi/js";
import {
  taskChoices,
  taskKindConfig,
  taskPriorityConfig,
  taskPriorityOrder,
  taskWhoConfig,
} from "~/utils/taskStyle";
import {
  taskEditPatch,
  type PriorityChoice,
  type Task,
  type TaskCreate,
  type TaskKind,
  type TaskOption,
  type TaskPatch,
  type TaskWho,
} from "~~/shared/tasks";

/** Adding a task, or changing one: the same form, empty or filled in. */

const props = defineProps<{
  /** The task being changed; none to add one. */
  task?: Task | null;
  tasks: readonly Task[];
  /** Resolves true once saved, so the dialog knows to close. */
  submit: (value: TaskCreate | TaskPatch) => Promise<boolean>;
}>();

const open = defineModel<boolean>({ default: false });

const editing = computed(() => !!props.task);
const saving = ref(false);

const empty = () => ({
  title: "",
  body: "",
  kind: "task" as TaskKind,
  who: "owner" as TaskWho,
  priority: "normal" as PriorityChoice,
  dependsOn: [] as string[],
  tags: [] as string[],
  links: [] as string[],
  branches: [] as string[],
  question: "",
  options: [] as TaskOption[],
  recommended: null as string | null,
});

const form = reactive(empty());

// Filled in afresh each time it opens, so a cancelled edit leaves nothing
// behind for the next one.
watch(open, (isOpen) => {
  if (!isOpen) return;
  const task = props.task;
  Object.assign(
    form,
    task
      ? {
          title: task.title,
          body: task.body,
          kind: task.kind,
          who: task.who,
          priority: task.priority ?? "normal",
          dependsOn: [...task.dependsOn],
          tags: [...task.tags],
          links: [...task.links],
          branches: [...task.branches],
          question: task.question ?? "",
          options: (task.options ?? []).map((o) => ({ ...o })),
          recommended: task.recommended ?? null,
        }
      : empty(),
  );
});

/** A merge is of a branch: without one there is nothing to check main for. */
const missingBranch = computed(
  () => form.kind === "merge" && trimmed(form.branches).length === 0,
);

/** The next letter no option has: keys stay put when one is taken away, so
 * a pick already made keeps meaning the same answer. */
function addOption() {
  const taken = new Set(form.options.map((o) => o.key));
  const key = [..."ABCDEFGH"].find((letter) => !taken.has(letter));
  if (key) form.options.push({ key, title: "" });
}

const candidates = computed(() =>
  taskChoices(props.tasks.filter((t) => t.id !== props.task?.id)),
);

/** The options with words in them, and the recommendation if it is one of
 * them. Only a decision has either. */
function decisionFields(): Pick<
  TaskCreate,
  "question" | "options" | "recommended"
> {
  if (form.kind !== "decision") {
    return { question: "", options: [], recommended: undefined };
  }
  const options = form.options
    .map((o) => ({ key: o.key, title: o.title.trim() }))
    .filter((o) => o.title);
  const recommended = options.find((o) => o.key === form.recommended)?.key;
  return { question: form.question.trim(), options, recommended };
}

const trimmed = (values: string[]) => [
  ...new Set(values.map((v) => v.trim()).filter(Boolean)),
];

async function save() {
  saving.value = true;
  const value = {
    title: form.title.trim(),
    body: form.body,
    kind: form.kind,
    who: form.who,
    priority: form.priority === "normal" ? undefined : form.priority,
    dependsOn: form.dependsOn,
    tags: trimmed(form.tags),
    links: trimmed(form.links),
    branches: trimmed(form.branches),
    ...decisionFields(),
  };
  try {
    if (!props.task) {
      if (await props.submit(value)) open.value = false;
      return;
    }
    // Only what was changed here: the task may have changed elsewhere since
    // the form was filled in, and those changes stay.
    const patch = taskEditPatch(props.task, value);
    if (!patch || (await props.submit(patch))) open.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.task-dialog__key {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--v-theme-ink-neutral));
  background: rgb(var(--v-theme-surface-muted));
}
</style>

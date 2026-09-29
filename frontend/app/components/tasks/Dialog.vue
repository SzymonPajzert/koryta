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
        <!-- What the page that opened the form has to say about the title as
             it is typed - on /admin/opinie, the tasks that look like it. -->
        <slot
          name="after-title"
          :title="form.title"
          :branches="form.branches"
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
          label="Gałęzie"
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Anuluj</v-btn>
        <v-btn
          color="ink-sage"
          variant="flat"
          :disabled="!form.title.trim()"
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
import { taskChoices, taskKindConfig, taskWhoConfig } from "~/utils/taskStyle";
import {
  taskEditPatch,
  type Task,
  type TaskCreate,
  type TaskEdit,
  type TaskKind,
  type TaskPatch,
  type TaskWho,
} from "~~/shared/tasks";

/** Adding a task, or changing one: the same form, empty or filled in. */

const props = defineProps<{
  /** The task being changed; none to add one. */
  task?: Task | null;
  /** What a new task starts as, when it is made from something else - a
   * report on /admin/opinie. Ignored when a task is being changed. */
  draft?: Partial<TaskEdit> | null;
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
  dependsOn: [] as string[],
  tags: [] as string[],
  links: [] as string[],
  branches: [] as string[],
});

const form = reactive(empty());

// Filled in afresh each time it opens, so a cancelled edit leaves nothing
// behind for the next one.
watch(open, (isOpen) => {
  if (!isOpen) return;
  const task = props.task;
  const draft = props.draft;
  Object.assign(
    form,
    task
      ? {
          title: task.title,
          body: task.body,
          kind: task.kind,
          who: task.who,
          dependsOn: [...task.dependsOn],
          tags: [...task.tags],
          links: [...task.links],
          branches: [...task.branches],
        }
      : draft
        ? {
            ...empty(),
            ...draft,
            // Copies, so what is typed stays out of the draft it came from.
            dependsOn: [...(draft.dependsOn ?? [])],
            tags: [...(draft.tags ?? [])],
            links: [...(draft.links ?? [])],
            branches: [...(draft.branches ?? [])],
          }
        : empty(),
  );
});

const candidates = computed(() =>
  taskChoices(props.tasks.filter((t) => t.id !== props.task?.id)),
);

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
    dependsOn: form.dependsOn,
    tags: trimmed(form.tags),
    links: trimmed(form.links),
    branches: trimmed(form.branches),
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

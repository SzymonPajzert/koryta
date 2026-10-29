<template>
  <div class="ow-series">
    <AdminRowList>
      <OswiadczeniaSeriesRow
        v-for="(task, index) in tasks"
        :key="task.id"
        :ref="(row) => remember(task.id, row)"
        :task="task"
        :position="index + 1"
        :draft="drafts[task.id] ?? null"
        :active="activeId === task.id"
        @focusin="activeId = task.id"
        @answer="(answered, answer) => onAnswer(answered, index, answer)"
      />
    </AdminRowList>
    <p class="ow-series__keys d-none d-sm-block">
      <kbd>Enter</kbd> zapisuje wiersz i przechodzi do następnego. Kliknięcie
      wycinka pokazuje albo chowa linijkę z imieniem i nazwiskiem.
    </p>
  </div>
</template>

<script setup lang="ts">
import type {
  DeclarationAnswer,
  DeclarationTask,
} from "~~/shared/declarations";

/**
 * TEMP(wariant): variant c, „seria”, of the /oswiadczenia round.
 *
 * For a reader at a computer with a run of them to do: the crop to read and
 * the two after it, one under another, each with its own field. Enter saves a
 * row and puts the caret in the row that takes its place, so a run of dates is
 * typed without touching the mouse, and the next crop is already on screen
 * while the last one is being typed.
 */
const props = withDefaults(
  defineProps<{
    tasks: DeclarationTask[];
    /** What was typed into rows whose save failed, by task id. */
    drafts?: Record<string, { date: string; name: string }>;
    autofocus?: boolean;
  }>(),
  { drafts: () => ({}), autofocus: false },
);

const emit = defineEmits<{
  answer: [task: DeclarationTask, answer: DeclarationAnswer];
}>();

type RowHandle = { focus: () => void };
const rows = new Map<string, RowHandle>();
const activeId = ref<string | null>(null);

function remember(id: string, row: unknown) {
  if (row) rows.set(id, row as RowHandle);
  else rows.delete(id);
}

function focusRow(index: number) {
  const task = props.tasks[Math.min(index, props.tasks.length - 1)];
  if (!task) return;
  rows.get(task.id)?.focus();
  activeId.value = task.id;
}

/** The page drops the answered row at once; the row that slides into its
 * place - the next one, or a new one at the end - takes the caret. */
async function onAnswer(
  task: DeclarationTask,
  index: number,
  answer: DeclarationAnswer,
) {
  emit("answer", task, answer);
  await nextTick();
  focusRow(index);
}

// With the list emptied and filled again from the server, the caret goes to
// the first row once there is one.
watch(
  () => props.tasks.length,
  (length, before) => {
    if (before === 0 && length > 0 && props.autofocus) {
      void nextTick(() => focusRow(0));
    }
  },
);

onMounted(() => {
  if (props.autofocus) focusRow(0);
  else activeId.value = props.tasks[0]?.id ?? null;
});
</script>

<style scoped>
.ow-series__keys {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  margin: 10px 0 0;
}

.ow-series__keys kbd {
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0 5px;
}
</style>

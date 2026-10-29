<template>
  <AdminExpandRow
    v-model:expanded="open"
    :tone="active ? 'strong' : 'neutral'"
    :label="`Wycinek ${position}, ${context}: pokaż linijkę z imieniem i nazwiskiem`"
    class="ow-row"
    data-testid="declaration-task"
  >
    <!-- Inert, as the row's toggle wants it: the crop is a picture to read,
         and a click on it opens the row. -->
    <template #summary>
      <span
        class="ow-row__summary"
        :style="{
          '--crop-w': task.imageSize.date.width,
          '--crop-h': task.imageSize.date.height,
        }"
      >
        <img
          :src="task.images.date"
          :width="task.imageSize.date.width"
          :height="task.imageSize.date.height"
          alt=""
          class="ow-row__crop"
          :style="{ maxWidth: `${task.imageSize.date.width * 2}px` }"
          data-testid="declaration-crop-date"
          draggable="false"
        />
        <span class="ow-row__context">{{ context }}</span>
      </span>
    </template>

    <template #actions>
      <form :id="formId" class="ow-row__form" novalidate @submit.prevent="save">
        <label :for="dateId" class="ow-row__label">urodzony(a)</label>
        <div class="ow-row__field">
          <input
            :id="dateId"
            ref="dateInput"
            v-model="dateText"
            class="ow-row__input"
            :class="{ 'ow-row__input--error': attempted && !valid }"
            data-testid="declaration-date-input"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="next"
            placeholder="dd.mm.rrrr"
          />
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            height="40"
            class="text-none"
            data-testid="declaration-submit"
          >
            Zapisz
          </v-btn>
        </div>
        <OswiadczeniaReading
          :text="dateText"
          :attempted="attempted"
          :quiet="!active"
          compact
          class="mt-1"
        />
        <div class="ow-row__other">
          <v-btn
            variant="text"
            size="small"
            slim
            class="text-none"
            data-testid="declaration-unreadable"
            @click="answerWith('unreadable')"
          >
            Nie da się odczytać
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            slim
            class="text-none"
            data-testid="declaration-empty-field"
            @click="answerWith('empty')"
          >
            Pole jest puste
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            slim
            class="text-none"
            data-testid="declaration-skip"
            @click="emit('answer', task, { verdict: 'skip' })"
          >
            Pomiń
          </v-btn>
        </div>
      </form>
    </template>

    <!-- On a phone the row's own line shows the start of the crop, where the
         date usually is; the open row has the whole line, to move along. -->
    <div class="ow-row__whole d-sm-none">
      <p class="ow-row__caption">Cała linijka z datą</p>
      <OswiadczeniaCrop
        :src="task.images.date"
        :width="task.imageSize.date.width"
        :height="task.imageSize.date.height"
        alt="Linijka oświadczenia z datą urodzenia"
      />
    </div>
    <template v-if="nameImage">
      <OswiadczeniaCrop
        :src="nameImage.src"
        :width="nameImage.width"
        :height="nameImage.height"
        alt="Linijka oświadczenia z imieniem i nazwiskiem"
        :max-scale="0.6"
        :min-height="44"
        :readable-height="60"
        testid="declaration-crop-name"
      />
      <div class="ow-row__name">
        <label :for="nameId" class="ow-row__label">imiona i nazwisko</label>
        <!-- Outside the form in the markup, inside it for the browser: Enter
             here saves the row, date and name together. -->
        <input
          :id="nameId"
          v-model="name"
          :form="formId"
          class="ow-row__input ow-row__input--name"
          data-testid="declaration-name-input"
          autocomplete="off"
          autocapitalize="words"
          spellcheck="false"
          enterkeyhint="next"
          placeholder="jeśli je widać - nieobowiązkowo"
        />
      </div>
    </template>
    <p v-else class="ow-row__none">
      Na tym wycinku nie ma linijki z imieniem i nazwiskiem.
    </p>
  </AdminExpandRow>
</template>

<script setup lang="ts">
import { useDisplay } from "vuetify";
import type {
  DeclarationAnswer,
  DeclarationTask,
} from "~~/shared/declarations";
import { readTyped, taskContext } from "~/utils/declarationReading";

/**
 * TEMP(wariant): one row of variant c, „seria”, of the /oswiadczenia round.
 *
 * A line of the quiet rail, as every list somebody works through on the site
 * is: the date crop is the line itself, and the date field sits at its end,
 * where it works without opening the row. The open row holds the name line of
 * the paper - under the date here, out of the paper's order, because the date
 * is what the row is for. No fact strip: the unit, the office and the year are
 * already the line's caption.
 *
 * On a computer the first row is the crop being read now and opens by itself,
 * so its name line is there without a click. On a phone a row is tall already,
 * the field under its line rather than beside it, so none opens by itself.
 */
const props = withDefaults(
  defineProps<{
    task: DeclarationTask;
    position: number;
    draft?: { date: string; name: string } | null;
    /** The row the caret is in: its rail is drawn in the strong ink, the
     * others in the neutral one. */
    active?: boolean;
  }>(),
  { draft: null, active: false },
);

const emit = defineEmits<{
  answer: [task: DeclarationTask, answer: DeclarationAnswer];
}>();

const { smAndUp } = useDisplay();

const open = ref(props.position === 1 && smAndUp.value);
// The row that moves up to the top is the one being read now.
watch(
  () => props.position,
  (position) => {
    if (position === 1 && smAndUp.value) open.value = true;
  },
);
const dateText = ref(props.draft?.date ?? "");
const name = ref(props.draft?.name ?? "");
const attempted = ref(false);

const formId = useId();
const dateId = useId();
const nameId = useId();
const dateInput = useTemplateRef<HTMLInputElement>("dateInput");

const context = computed(() => taskContext(props.task));
const valid = computed(() => readTyped(dateText.value).state === "ok");

const nameImage = computed(() => {
  const { images, imageSize } = props.task;
  return images.name && imageSize.name
    ? { src: images.name, ...imageSize.name }
    : null;
});

function withName(answer: DeclarationAnswer): DeclarationAnswer {
  const typed = name.value.trim();
  return typed && nameImage.value ? { ...answer, name: typed } : answer;
}

function save() {
  const reading = readTyped(dateText.value);
  if (reading.state !== "ok") {
    attempted.value = true;
    dateInput.value?.focus();
    return;
  }
  emit(
    "answer",
    props.task,
    withName({ verdict: "date", value: reading.value }),
  );
}

function answerWith(verdict: "unreadable" | "empty") {
  emit("answer", props.task, withName({ verdict }));
}

defineExpose({ focus: () => dateInput.value?.focus() });
</script>

<style scoped>
.ow-row__summary {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 0;
}

.ow-row__crop {
  border-radius: 4px;
  display: block;
  height: auto;
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
  width: 100%;
}

.ow-row__context {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  line-height: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ow-row__form {
  display: flex;
  flex-direction: column;
  padding: 10px 12px 8px 16px;
  width: 316px;
}

.ow-row__label {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  margin-bottom: 4px;
}

.ow-row__field {
  display: flex;
  gap: 6px;
}

.ow-row__input {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.38);
  border-radius: 6px;
  color: rgb(var(--v-theme-ink-strong));
  flex: 1 1 auto;
  font: inherit;
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  height: 40px;
  min-width: 0;
  padding: 0 10px;
}

.ow-row__input--name {
  font-size: 1rem;
  font-weight: 400;
}

.ow-row__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-weight: 400;
}

.ow-row__input:focus {
  border-color: rgb(var(--v-theme-ink-strong));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-ink-strong));
  outline: none;
}

.ow-row__input--error,
.ow-row__input--error:focus {
  border-color: rgb(var(--v-theme-ink-danger));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-ink-danger));
}

/* Sentence case reads as a sentence: Vuetify's tracking is drawn for its
   capitals, and on lower case it spaces the words apart. */
.ow-row__form .v-btn {
  letter-spacing: 0.01em;
}

.ow-row__other {
  display: flex;
  flex-wrap: wrap;
  margin: 2px 0 0 -8px;
}

.ow-row__whole {
  margin-bottom: 16px;
}

.ow-row__caption {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.75rem;
  line-height: 1rem;
  margin: 0 0 4px;
}

.ow-row__name {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  max-width: 420px;
}

.ow-row__none {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  margin: 0;
}

/* The line and its field side by side need more than a phone has: the
   field drops under the crop, across the full row. */
@media (max-width: 599.98px) {
  .ow-row :deep(.arow__head) {
    align-items: stretch;
    flex-wrap: wrap;
  }

  /* Border-box, or the indent comes on top of the full width; and no
     minimum, or a text input's own width (about 20 characters) holds the
     strip wider than the row, and the list clips the end of the field. */
  .ow-row :deep(.arow__actions) {
    box-sizing: border-box;
    flex: 1 1 100%;
    min-width: 0;
    padding: 0 0 4px 32px;
  }

  .ow-row__summary {
    container-type: inline-size;
  }

  /* The whole line fitted to a phone is a 35 px strip nobody can read, so
     the row's line is its start instead, sized by the rule the pannable
     crops follow (`OswiadczeniaCrop`): 55% of the line in view, between 60
     and 76 px tall, and faded where it is cut. */
  .ow-row__crop {
    -webkit-mask-image: linear-gradient(
      to right,
      black calc(100% - 48px),
      transparent
    );
    mask-image: linear-gradient(to right, black calc(100% - 48px), transparent);
    height: clamp(
      min(60px, calc(var(--crop-h) * 1px)),
      calc(100cqw * var(--crop-h) / (0.55 * var(--crop-w))),
      min(76px, calc(var(--crop-h) * 1px))
    );
    object-fit: cover;
    object-position: left center;
  }

  .ow-row__form {
    box-sizing: border-box;
    min-width: 0;
    padding: 0 12px 8px 0;
    width: 100%;
  }

  /* The caption is the only place the row names its unit, so it wraps
     rather than losing the end of a long one. */
  .ow-row__context {
    white-space: normal;
  }
}
</style>

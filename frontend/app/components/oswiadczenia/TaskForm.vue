<template>
  <article class="ow-form" data-testid="declaration-task">
    <!-- A real form, so Enter in any blank saves: the browser submits it
         through the Zapisz button, from the date and the name alike. -->
    <form class="ow-form__sheet" novalidate @submit.prevent="save">
      <p class="ow-form__context">{{ context }}</p>

      <!-- The paper's order: the name line sits right above the date line.
           Smaller, because it is the optional one. -->
      <div v-if="nameImage" class="ow-line ow-line--name">
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
        <div class="ow-blank ow-blank--name">
          <label :for="nameId" class="ow-printed">imiona i nazwisko</label>
          <input
            :id="nameId"
            v-model="name"
            class="ow-blank__name"
            data-testid="declaration-name-input"
            autocomplete="off"
            autocapitalize="words"
            spellcheck="false"
            enterkeyhint="done"
            placeholder="jeśli je widać - nieobowiązkowo"
          />
        </div>
      </div>

      <div class="ow-line ow-line--date">
        <OswiadczeniaCrop
          :src="task.images.date"
          :width="task.imageSize.date.width"
          :height="task.imageSize.date.height"
          alt="Linijka oświadczenia z datą urodzenia"
          testid="declaration-crop-date"
        />
        <div class="ow-blank ow-blank--date">
          <span :id="labelId" class="ow-printed">urodzony(a)</span>
          <OswiadczeniaDateSegments
            ref="segments"
            v-model="dateText"
            :labelledby="labelId"
            :error="attempted && !valid"
            data-testid="declaration-date-input"
          />
          <OswiadczeniaReading
            :text="dateText"
            :attempted="attempted"
            class="ow-blank__reading"
          />
        </div>
      </div>

      <div class="ow-form__actions">
        <v-btn
          type="submit"
          color="primary"
          variant="flat"
          size="large"
          class="text-none ow-form__save"
          data-testid="declaration-submit"
        >
          Zapisz
          <kbd class="ow-kbd d-none d-sm-inline">Enter</kbd>
        </v-btn>
        <v-btn
          variant="text"
          class="text-none"
          data-testid="declaration-unreadable"
          @click="answerWith('unreadable')"
        >
          Nie da się odczytać
        </v-btn>
        <v-btn
          variant="text"
          class="text-none"
          data-testid="declaration-empty-field"
          @click="answerWith('empty')"
        >
          Pole jest puste
        </v-btn>
        <v-spacer class="d-none d-sm-block" />
        <v-btn
          variant="text"
          class="text-none"
          :append-icon="mdiArrowRight"
          data-testid="declaration-skip"
          @click="emit('answer', task, { verdict: 'skip' })"
        >
          Pomiń
        </v-btn>
      </div>
    </form>
  </article>
</template>

<script setup lang="ts">
import { mdiArrowRight } from "@mdi/js";
import type {
  DeclarationAnswer,
  DeclarationTask,
} from "~~/shared/declarations";
import { readTyped, taskContext } from "~/utils/declarationReading";

/**
 * TEMP(wariant): variant a, „formularz”, of the /oswiadczenia round.
 *
 * The page continues the paper. Each line cut out of the declaration is
 * followed by its own blank, with the form's printed word in front of it -
 * „imiona i nazwisko”, „urodzony(a)” - and the reader copies the line into
 * the line under it: the date into three dotted blanks, DD . MM . RRRR, the way
 * the form itself asks for it.
 *
 * The date line leads: its crop is drawn at full fit and its blanks in 32 px
 * figures, while the name line above it is a smaller crop and a plain blank
 * nobody has to fill.
 */
const props = withDefaults(
  defineProps<{
    task: DeclarationTask;
    /** What the reader had typed, put back after a save that failed. */
    draft?: { date: string; name: string } | null;
    /** Whether to put the caret in the first blank. Not on a phone's first
     * crop: the keyboard would cover it before it was seen. */
    autofocus?: boolean;
  }>(),
  { draft: null, autofocus: false },
);

const emit = defineEmits<{
  answer: [task: DeclarationTask, answer: DeclarationAnswer];
}>();

const dateText = ref(props.draft?.date ?? "");
const name = ref(props.draft?.name ?? "");
const attempted = ref(false);

const nameId = useId();
const labelId = useId();
const segments = useTemplateRef<{ focus: () => void }>("segments");

const context = computed(() => taskContext(props.task));
const valid = computed(() => readTyped(dateText.value).state === "ok");

const nameImage = computed(() => {
  const { images, imageSize } = props.task;
  return images.name && imageSize.name
    ? { src: images.name, ...imageSize.name }
    : null;
});

/** The name only when there is one, and only with a verdict about the crop:
 * a skip says nothing about it. */
function withName(answer: DeclarationAnswer): DeclarationAnswer {
  const typed = name.value.trim();
  return typed && nameImage.value ? { ...answer, name: typed } : answer;
}

function save() {
  const reading = readTyped(dateText.value);
  if (reading.state !== "ok") {
    attempted.value = true;
    segments.value?.focus();
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

onMounted(() => {
  if (props.autofocus) segments.value?.focus();
});
</script>

<style scoped>
.ow-form__sheet {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  padding: 20px 24px 16px;
}

.ow-form__context {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  line-height: 1.25rem;
  margin: 0 0 16px;
}

.ow-line + .ow-line {
  margin-top: 28px;
}

.ow-line--name {
  /* The context line keeps to the size of its crop rather than running the
     sheet's width, so the eye reads it as the lesser of the two. */
  max-width: 720px;
}

.ow-blank {
  align-items: baseline;
  column-gap: 12px;
  display: flex;
  flex-wrap: wrap;
  margin-top: 8px;
  row-gap: 4px;
}

/* The form's printed words, in the form's small type. */
.ow-printed {
  color: rgb(var(--v-theme-ink-neutral));
  flex: none;
  font-size: 0.8125rem;
  letter-spacing: 0.01em;
}

.ow-blank__name {
  background: transparent;
  border: 0;
  border-bottom: 2px dotted rgba(var(--v-border-color), 0.45);
  color: rgb(var(--v-theme-ink-strong));
  flex: 1 1 220px;
  font: inherit;
  font-size: 1rem;
  line-height: 2rem;
  min-width: 0;
  padding: 0 4px;
}

.ow-blank__name::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.ow-blank__name:focus {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-bottom: 2px solid rgb(var(--v-theme-ink-info));
  outline: none;
}

.ow-blank__reading {
  flex: 1 1 200px;
  margin-left: 8px;
}

.ow-form__actions {
  align-items: center;
  border-top: 1px solid rgba(var(--v-border-color), 0.12);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
  padding-top: 16px;
}

/* Sentence case reads as a sentence: Vuetify's tracking is drawn for its
   capitals, and on lower case it spaces the words apart. */
.ow-form__actions .v-btn {
  letter-spacing: 0.01em;
}

.ow-kbd {
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 4px;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1rem;
  margin-left: 10px;
  opacity: 0.75;
  padding: 0 5px;
}

@media (max-width: 599.98px) {
  .ow-form__sheet {
    padding: 14px 12px 12px;
  }

  .ow-line + .ow-line {
    margin-top: 20px;
  }

  .ow-blank__reading {
    flex-basis: 100%;
    margin-left: 0;
  }

  /* One thumb-wide target for the answer that counts; the other three
     share the row under it. */
  .ow-form__save {
    flex: 1 1 100%;
  }

  .ow-form__actions {
    gap: 4px;
  }
}
</style>

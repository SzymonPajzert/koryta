<template>
  <article class="ow-card" data-testid="declaration-task">
    <!-- The paper as it is, on the desk tray: the date line, with the name
         line above it while readers are asked for names (READ_NAMES). -->
    <div class="ow-card__paper">
      <OswiadczeniaCrop
        v-if="nameImage"
        :src="nameImage.src"
        :width="nameImage.width"
        :height="nameImage.height"
        alt="Linijka oświadczenia z imieniem i nazwiskiem"
        :min-height="44"
        :readable-height="60"
        class="ow-card__name"
        testid="declaration-crop-name"
      />
      <OswiadczeniaCrop
        :src="task.images.date"
        :width="task.imageSize.date.width"
        :height="task.imageSize.date.height"
        alt="Linijka oświadczenia z datą urodzenia"
        testid="declaration-crop-date"
      />
    </div>

    <form class="ow-card__answer" novalidate @submit.prevent="press">
      <!-- What the field understood sits beside its label, above the field
           rather than under it: on a phone the keyboard rises to the field's
           lower edge, and „15 lipca 1979” under it would be read by nobody. -->
      <div class="ow-card__label-row">
        <label :for="dateId" class="ow-card__label">Data urodzenia</label>
        <OswiadczeniaReading
          :id="readingId"
          :text="dateText"
          :attempted="attempted"
          :stalled="stalled"
          compact
        />
      </div>
      <div class="ow-card__date-row">
        <!-- Digits only, on a phone's keypad and on a computer's keyboard:
             the field puts the dots of dd.mm.rrrr in itself (`dotTyped`),
             so the eight digits are all a reader types. -->
        <input
          :id="dateId"
          ref="dateInput"
          :value="dateText"
          class="ow-card__input ow-card__input--date"
          :class="{
            'ow-card__input--error': attempted && reading.state === 'problem',
          }"
          data-testid="declaration-date-input"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="done"
          placeholder="dd.mm.rrrr"
          :aria-describedby="readingId"
          @input="typeDate"
          @keydown.enter="enter"
        />
        <!-- One button for both ways on: „Zapisz” once all eight digits are
             typed, „Pomiń” until then. Part of a date is of no use, so a
             reader who started on a line they cannot finish moves on without
             clearing the field, and no reason is asked of them. Quiet while
             it skips, the page's colour once it saves; one width for both, so
             the field does not move under the thumb when it switches. -->
        <v-btn
          type="submit"
          :color="whole ? 'primary' : undefined"
          :variant="whole ? 'flat' : 'tonal'"
          :append-icon="whole ? undefined : mdiArrowRight"
          height="52"
          min-width="112"
          class="text-none ow-card__save"
          :data-testid="whole ? 'declaration-submit' : 'declaration-skip'"
        >
          {{ whole ? "Zapisz" : "Pomiń" }}
        </v-btn>
      </div>

      <template v-if="nameImage">
        <label :for="nameId" class="ow-card__label ow-card__label--name">
          Imię i nazwisko, jeśli je widać
        </label>
        <!-- No longer than the server takes: a longer name would have the
             whole answer, its date with it, turned down. -->
        <input
          :id="nameId"
          v-model="name"
          class="ow-card__input ow-card__input--name"
          data-testid="declaration-name-input"
          :maxlength="READ_NAME_MAX_LENGTH"
          autocomplete="off"
          autocapitalize="words"
          spellcheck="false"
          enterkeyhint="done"
          placeholder="nieobowiązkowo"
          @keydown.enter="enter"
        />
      </template>
    </form>
  </article>
</template>

<script setup lang="ts">
import { mdiArrowRight } from "@mdi/js";
import {
  READ_NAME_MAX_LENGTH,
  READ_NAMES,
  type DeclarationAnswer,
  type DeclarationTask,
} from "~~/shared/declarations";
import { dotTyped, readTyped } from "~/utils/declarationReading";

/**
 * The reading card of /oswiadczenia, „jedno pole”: picked over the form-like
 * line and the series in round bip-czytanie-r1.
 *
 * A compact card made for a phone: the date line of the paper on a tray, and
 * under it one field for the date's eight digits, which puts the dots in
 * itself, with what it understood said back beside the field's label. One
 * field and one button in a row is all a thumb needs: the button skips the
 * crop until the whole date is typed and saves it once it is. The server
 * still takes „unreadable”, „empty” and a year alone; the card no longer asks
 * for them.
 */
const props = withDefaults(
  defineProps<{
    task: DeclarationTask;
    draft?: { date: string; name: string } | null;
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

const dateId = useId();
const nameId = useId();
const readingId = useId();
const dateInput = useTemplateRef<HTMLInputElement>("dateInput");

const reading = computed(() => readTyped(dateText.value));
/** All eight digits are typed: the button saves the date, or says what is
 * wrong with it, rather than skipping the crop. */
const whole = computed(
  () =>
    reading.value.state === "ok" ||
    (reading.value.state === "problem" && reading.value.whole),
);

/** How long a reader may stop typing short of the whole date before the line
 * beside the label says all eight digits are wanted. */
const STALL_MS = 3000;
const stalled = ref(false);
let stallTimer: ReturnType<typeof setTimeout> | undefined;

/** Starts the wait over at every key: what is missing is said once the
 * reader stops, never while they type. */
function waitForStall() {
  clearTimeout(stallTimer);
  stalled.value = false;
  if (reading.value.state !== "problem" || reading.value.whole) return;
  stallTimer = setTimeout(() => (stalled.value = true), STALL_MS);
}

/** Puts the dots in as the reader types (`dotTyped`). The field is set here
 * rather than left to `dateText`: a key that changes nothing in the text, a
 * letter, has to come out of the field too. */
function typeDate(event: Event) {
  const input = event.target as HTMLInputElement;
  const { inputType, data } = event as InputEvent;
  const next = dotTyped(
    input.value,
    input.selectionStart ?? input.value.length,
    inputType === "insertText" ? data : null,
  );
  if (next.text !== input.value) {
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
  }
  dateText.value = next.text;
  waitForStall();
}

onBeforeUnmount(() => clearTimeout(stallTimer));

const nameImage = computed(() => {
  const { images, imageSize } = props.task;
  return READ_NAMES && images.name && imageSize.name
    ? { src: images.name, ...imageSize.name }
    : null;
});

function withName(answer: DeclarationAnswer): DeclarationAnswer {
  const typed = name.value.trim();
  return typed && nameImage.value ? { ...answer, name: typed } : answer;
}

/** The button: a whole date is saved, or refused with the reason said beside
 * the label. Short of it the crop is skipped, with what was typed: part of a
 * date is of no use. */
function press() {
  if (whole.value) save();
  else emit("answer", props.task, { verdict: "skip" });
}

/** Enter in a field: an empty field skips the crop and a whole date is saved,
 * as the button does. A date short of whole is not thrown away by the key
 * that saves: what is missing is said beside the label, and „Pomiń” is a tap
 * away. Enter on the button itself is the button's. */
function enter(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  if (reading.value.state === "empty") {
    emit("answer", props.task, { verdict: "skip" });
  } else save();
}

function save() {
  const typed = reading.value;
  if (typed.state !== "ok") {
    attempted.value = true;
    dateInput.value?.focus();
    return;
  }
  emit("answer", props.task, withName({ verdict: "date", value: typed.value }));
}

onMounted(() => {
  if (props.autofocus) dateInput.value?.focus();
  // A crop that came back with part of a date typed into it.
  waitForStall();
});

/** Brings the date field into the middle of the window, with the lines of
 * the paper above it: a field that is only scrolled to the window's edge
 * (what focusing it does) can end up under the app bar, which stays at the
 * top of the window. */
function show() {
  dateInput.value?.scrollIntoView({ block: "center" });
}

defineExpose({
  /** What is typed into the card and not sent yet. */
  typed: () => ({ date: dateText.value, name: name.value }),
  /** Brings the card back into the window, for a page that sent the reader
   * elsewhere: a sign-in from under the work, say. */
  show,
  /** The same, with the caret in the date field, for a page that took it
   * away: a dialog opened over the card, say. */
  focus: () => {
    show();
    dateInput.value?.focus({ preventScroll: true });
  },
});
</script>

<style scoped>
.ow-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 10px;
  padding: 16px;
}

/* The desk the paper lies on: the one tinted surface on the card, so the
   lines on it are the first thing the eye lands on. */
.ow-card__paper {
  background: rgb(var(--v-theme-surface-muted));
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 8px;
}

/* On the tinted tray a scan's paper is close to the tray itself, so its cut
   edge takes a slightly firmer hairline than on white. */
.ow-card__paper :deep(.ow-crop__img) {
  outline-color: rgba(0, 0, 0, 0.16);
}

.ow-card__answer {
  display: flex;
  flex-direction: column;
  margin-top: 16px;
}

.ow-card__label-row {
  align-items: center;
  column-gap: 12px;
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 6px;
  row-gap: 2px;
}

.ow-card__label {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25rem;
}

.ow-card__label--name {
  margin: 16px 0 6px;
}

.ow-card__date-row {
  display: flex;
  gap: 8px;
}

.ow-card__input {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.38);
  border-radius: 8px;
  color: rgb(var(--v-theme-ink-strong));
  font: inherit;
  min-width: 0;
  padding: 0 14px;
}

.ow-card__input--date {
  flex: 1 1 auto;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  height: 52px;
  letter-spacing: 0.03em;
}

.ow-card__input--name {
  font-size: 1rem;
  height: 44px;
}

.ow-card__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-weight: 400;
}

/* Firm enough to find, quieter than the crops: the dark sage ink rather
   than black, which in round 1 outweighed the lines it is there to copy. */
.ow-card__input:focus {
  border-color: rgb(var(--v-theme-ink-sage));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-ink-sage));
  outline: none;
}

.ow-card__input--error,
.ow-card__input--error:focus {
  border-color: rgb(var(--v-theme-ink-danger));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-ink-danger));
}

.ow-card__save {
  flex: none;
  padding-inline: 20px;
}

/* Sentence case reads as a sentence: Vuetify's tracking is drawn for its
   capitals, and on lower case it spaces the words apart. */
.ow-card__answer .v-btn {
  letter-spacing: 0.01em;
}

/* A name crop is wider than a date crop, so fitted to the same tray it
   comes out as tall: held to four fifths of it, the date line leads. On a
   phone both pan, and the name line keeps the whole width to pan in. */
@media (min-width: 600px) {
  .ow-card__name {
    max-width: 80%;
  }
}

@media (max-width: 599.98px) {
  .ow-card {
    padding: 12px;
  }

  .ow-card__paper {
    padding: 6px;
  }
}
</style>

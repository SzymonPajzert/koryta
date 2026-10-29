<template>
  <div
    class="ow-seg"
    :class="{ 'ow-seg--error': error }"
    role="group"
    :aria-labelledby="labelledby"
  >
    <input
      ref="dayEl"
      :value="day"
      class="ow-seg__input ow-seg__input--day"
      inputmode="numeric"
      autocomplete="off"
      enterkeyhint="done"
      placeholder="DD"
      aria-label="Dzień"
      @input="onInput('day', $event)"
      @keydown="onKeydown('day', $event)"
      @focus="selectAll"
    />
    <span class="ow-seg__dot" aria-hidden="true">.</span>
    <input
      ref="monthEl"
      :value="month"
      class="ow-seg__input ow-seg__input--month"
      :style="{ width: `${Math.max(2, month.length) + 0.5}ch` }"
      inputmode="numeric"
      autocomplete="off"
      enterkeyhint="done"
      placeholder="MM"
      aria-label="Miesiąc, cyfrą albo rzymską"
      @input="onInput('month', $event)"
      @keydown="onKeydown('month', $event)"
      @focus="selectAll"
    />
    <span class="ow-seg__dot" aria-hidden="true">.</span>
    <input
      ref="yearEl"
      :value="year"
      class="ow-seg__input ow-seg__input--year"
      inputmode="numeric"
      autocomplete="off"
      enterkeyhint="done"
      placeholder="RRRR"
      aria-label="Rok"
      @input="onInput('year', $event)"
      @keydown="onKeydown('year', $event)"
      @focus="selectAll"
    />
  </div>
</template>

<script setup lang="ts">
import { parseTypedDate } from "~~/shared/declarations";

/**
 * „urodzony(a) 15 . 07 . 1979”: the date line of the form, filled in the way
 * the paper is - three blanks, typed straight through.
 *
 * The model is one string, the way the other variants' single field holds
 * it, so `parseTypedDate` reads all of them alike: „15.07.1979”, „15.VII.1979”
 * once a Roman month is typed, or „1979” when only the year is filled.
 *
 * Typing moves on by itself: a full day goes to the month, a full month to
 * the year, and a dot, a slash, a dash or a space closes a one-digit day or
 * month („5.” is the 5th). A day starting 4-9 can only be one digit, so it is
 * closed at once. Backspace in an empty blank goes back to the one before.
 * A whole date pasted - or filled by a test - into any blank is spread over
 * all three, and „1979” typed into the day, by somebody who did not see the
 * blanks, ends up in the year.
 */
defineProps<{
  /** The id of the printed label, „urodzony(a)”, the group is named by. */
  labelledby?: string;
  error?: boolean;
}>();

const model = defineModel<string>({ default: "" });

type Part = "day" | "month" | "year";
const PARTS: Part[] = ["day", "month", "year"];

const day = ref("");
const month = ref("");
const year = ref("");

const dayEl = useTemplateRef<HTMLInputElement>("dayEl");
const monthEl = useTemplateRef<HTMLInputElement>("monthEl");
const yearEl = useTemplateRef<HTMLInputElement>("yearEl");

const elementOf = (part: Part) =>
  ({ day: dayEl, month: monthEl, year: yearEl })[part].value;
const valueOf = (part: Part) => ({ day, month, year })[part];

const ROMAN = /^[ivx]+$/i;
const SEPARATORS = /[\s./,-]+/;

function compose(): string {
  if (!day.value && !month.value && !year.value) return "";
  if (!day.value && !month.value) return year.value;
  return `${day.value}.${month.value}.${year.value}`;
}

/** A month as the blank holds it: two digits, or a Roman numeral as typed. A
 * word („lipca”) arrives only by pasting, and is turned into its number. */
function monthBlank(token: string): string {
  if (/^\d+$/.test(token)) return token.slice(0, 2);
  if (ROMAN.test(token)) return token.toUpperCase().slice(0, 4);
  const asDate = parseTypedDate(`1 ${token} 2000`);
  return asDate.kind === "date" ? asDate.value.slice(5, 7) : "";
}

/** Text that is more than one blank holds, spread over all three. */
function spread(text: string) {
  const parsed = parseTypedDate(text);
  if (parsed.kind === "date") {
    [year.value, month.value, day.value] = parsed.value.split("-") as [
      string,
      string,
      string,
    ];
    return;
  }
  if (parsed.kind === "year") {
    [day.value, month.value, year.value] = ["", "", parsed.value];
    return;
  }
  const tokens = text.trim().split(SEPARATORS).filter(Boolean);
  if (tokens.length >= 2) {
    const yearFirst = /^\d{4}$/.test(tokens[0]!);
    const [d, m, y] = yearFirst
      ? [tokens[2] ?? "", tokens[1]!, tokens[0]!]
      : [tokens[0]!, tokens[1]!, tokens[2] ?? ""];
    day.value = d.replace(/\D/g, "").slice(0, 2);
    month.value = monthBlank(m);
    year.value = y.replace(/\D/g, "").slice(0, 4);
    return;
  }
  const digits = text.replace(/\D/g, "");
  day.value = digits.slice(0, 2);
  month.value = digits.slice(2, 4);
  year.value = digits.slice(4, 8);
}

/** The blanks show what the state holds, even where the state did not change
 * - a letter typed into the day is dropped, and Vue sees nothing to redraw. */
function syncInputs() {
  for (const part of PARTS) {
    const el = elementOf(part);
    if (el && el.value !== valueOf(part).value) el.value = valueOf(part).value;
  }
}

function focusPart(part: Part, caret: "start" | "end" | "all" = "all") {
  const el = elementOf(part);
  if (!el) return;
  el.focus();
  if (caret === "all") el.select();
  else {
    const at = caret === "start" ? 0 : el.value.length;
    el.setSelectionRange(at, at);
  }
}

function firstIncomplete(): Part {
  if (!day.value && !month.value && year.value) return "year";
  if (day.value.length < 2) return "day";
  if (!month.value) return "month";
  return "year";
}

function commit() {
  model.value = compose();
  syncInputs();
}

function spreadAndMoveOn(text: string) {
  spread(text);
  commit();
  focusPart(firstIncomplete(), "end");
}

/** Set while the year blank holds a year made of the first two blanks, „19”
 * and „81”. Typed key by key, „1981” and the 19th of August with a one-figure
 * month start the same way, „19”, „8”, „1”; the next key tells them apart, so
 * the year stands until then and any other input ends it. */
let yearFromDay = false;

function onInput(part: Part, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const tokens = raw.split(SEPARATORS).filter(Boolean);
  const closed = SEPARATORS.test(raw.slice(-1));
  const wasYearFromDay = yearFromDay;
  yearFromDay = false;

  // A whole date arriving at once, into any blank, is spread over all three.
  if (parseTypedDate(raw).kind === "date") return spreadAndMoveOn(raw);
  const token = tokens[0] ?? "";

  if (part === "day") {
    // „15.07”, „1507” or „1979”: more than a day, typed or pasted.
    if (tokens.length > 1 || /^\d{3,}$/.test(raw)) return spreadAndMoveOn(raw);
    const digits = token.replace(/\D/g, "");
    day.value =
      digits.length === 1 && (closed || Number(digits) > 3)
        ? `0${digits}`
        : digits.slice(0, 2);
    commit();
    if (day.value.length === 2) focusPart("month");
    return;
  }

  if (part === "month") {
    if (tokens.length > 1) return spreadAndMoveOn(`${day.value}.${raw}`);
    if (ROMAN.test(token)) {
      month.value = token.toUpperCase().slice(0, 4);
      commit();
      if (closed) focusPart("year");
      return;
    }
    // „VII1”: a Roman month needs no dot after it, its first figure is
    // already the year's.
    const romanThenYear = /^([ivx]+)(\d+)$/i.exec(token);
    if (romanThenYear) {
      month.value = romanThenYear[1]!.toUpperCase().slice(0, 4);
      year.value = romanThenYear[2]!.slice(0, 4);
      commit();
      focusPart("year", "end");
      return;
    }
    const digits = token.replace(/\D/g, "");
    if (digits.length > 2) {
      // Typed past the end of the blank: the rest belongs to the year.
      if (day.value.length === 2) return spreadAndMoveOn(day.value + digits);
      month.value = digits.slice(0, 2);
      commit();
      focusPart("year", "end");
      return;
    }
    // „19” and then „79” is a year typed from the first blank - for now: see
    // `yearFromDay`.
    if (
      digits.length === 2 &&
      Number(digits) > 12 &&
      (day.value === "19" || day.value === "20")
    ) {
      [year.value, day.value, month.value] = [`${day.value}${digits}`, "", ""];
      commit();
      yearFromDay = true;
      focusPart("year", "end");
      return;
    }
    const mayStartYear = day.value === "19" || day.value === "20";
    month.value =
      digits.length === 1 && (closed || (Number(digits) > 1 && !mayStartYear))
        ? `0${digits}`
        : digits;
    commit();
    if (month.value.length === 2) focusPart("year");
    return;
  }

  // A fifth figure after a year made of the first two blanks: they were a day
  // and a one-figure month after all, „19”, „7”, „1979” the 19th of July,
  // and the figures typed since are the year's.
  const figures = raw.replace(/\D/g, "");
  if (wasYearFromDay && figures.length === 5) {
    [day.value, month.value, year.value] = [
      figures.slice(0, 2),
      `0${figures[2]}`,
      figures.slice(3),
    ];
    commit();
    focusPart("year", "end");
    return;
  }
  // „1979 r.” keeps its four digits; nothing else goes past the year.
  year.value = /\d{4}/.exec(raw)?.[0] ?? figures.slice(0, 4);
  commit();
}

function onKeydown(part: Part, event: KeyboardEvent) {
  const el = event.target as HTMLInputElement;
  const index = PARTS.indexOf(part);
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
  const atEnd = el.selectionStart === el.value.length;

  if (event.key === "Backspace" && el.value === "" && index > 0) {
    event.preventDefault();
    focusPart(PARTS[index - 1]!, "end");
  } else if (event.key === "ArrowLeft" && atStart && index > 0) {
    event.preventDefault();
    focusPart(PARTS[index - 1]!, "end");
  } else if (event.key === "ArrowRight" && atEnd && index < PARTS.length - 1) {
    event.preventDefault();
    focusPart(PARTS[index + 1]!, "start");
  }
}

function selectAll(event: FocusEvent) {
  const el = event.target as HTMLInputElement;
  if (el.value) el.select();
}

// A reset, or a draft put back after a save that failed, comes in as text.
watch(
  model,
  (text) => {
    if (text === compose()) return;
    yearFromDay = false;
    spread(text ?? "");
    syncInputs();
  },
  { immediate: true },
);

defineExpose({
  /** Puts the caret in the first blank still to fill. */
  focus: () => focusPart(firstIncomplete(), "end"),
});
</script>

<style scoped>
.ow-seg {
  align-items: baseline;
  display: inline-flex;
  font-variant-numeric: tabular-nums;
  gap: 2px;
}

.ow-seg__input {
  background: transparent;
  border: 0;
  border-radius: 4px 4px 0 0;
  /* The form's own blank: a dotted line, not a box. */
  border-bottom: 2px dotted rgba(var(--v-border-color), 0.45);
  color: rgb(var(--v-theme-ink-strong));
  font: inherit;
  font-size: 2rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 2.5rem;
  padding: 0 2px;
  text-align: center;
}

.ow-seg__input--day {
  width: 2.5ch;
}

.ow-seg__input--year {
  width: 4.5ch;
}

/* The guide letters are the form's small print under each blank: smaller
   than the figures that replace them, so „RRRR” fits where „1979” goes. */
.ow-seg__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.38);
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.14em;
}

.ow-seg__input:focus {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-bottom: 2px solid rgb(var(--v-theme-ink-info));
  outline: none;
}

.ow-seg--error .ow-seg__input {
  border-bottom-color: rgb(var(--v-theme-ink-danger));
}

.ow-seg__dot {
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 1.5rem;
  font-weight: 500;
}

@media (max-width: 599.98px) {
  .ow-seg__input {
    font-size: 1.75rem;
    line-height: 2.25rem;
  }
}
</style>

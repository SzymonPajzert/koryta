<template>
  <!-- Opened here rather than by the tooltip's own hover and focus: it
       closes a hover tooltip that opens with no mouse over it, which is every
       tap on a phone. A mouse opens the words while it is over the line, the
       keyboard while it is on it, and a click or a tap until the next one
       elsewhere. -->
  <v-tooltip
    v-model="open"
    location="bottom"
    :open-on-hover="false"
    :open-on-focus="false"
    :offset="6"
    content-class="reading-progress__tip"
  >
    <template #activator="{ props: tip }">
      <button
        type="button"
        class="reading-progress"
        v-bind="tip"
        :aria-label="summary"
        data-testid="declaration-progress"
        @click="open = true"
        @pointerenter="pointing($event, true)"
        @pointerleave="pointing($event, false)"
        @focus="focused"
        @blur="open = false"
      >
        <span
          v-for="part in parts"
          :key="part.key"
          class="reading-progress__part"
          :style="{ flexGrow: part.value, backgroundColor: part.color }"
        />
      </button>
    </template>

    <div data-testid="declaration-progress-legend">
      <p class="reading-progress__line">
        Osoby:
        <span class="reading-progress__item">
          <span
            class="reading-progress__dot"
            :style="{ backgroundColor: DONE }"
          />
          gotowe <strong>{{ polishNumber(done) }}</strong>
        </span>
        <span class="reading-progress__item">
          <span
            class="reading-progress__dot"
            :style="{ backgroundColor: WAITING }"
          />
          czekają <strong>{{ polishNumber(waiting) }}</strong>
        </span>
      </p>
      <p class="reading-progress__line">
        <span class="reading-progress__item">
          <span
            class="reading-progress__dot"
            :style="{ backgroundColor: YOURS }"
          />
          Twoje odczyty: <strong>{{ polishNumber(yours) }}</strong>
        </span>
      </p>
    </div>
  </v-tooltip>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { polishNumber } from "~/composables/polish";
import { ink } from "~/utils/chartTheme";
import { brand, role } from "~~/shared/colors";
import type { DeclarationPeople } from "~~/shared/declarations";

/**
 * How far the readers got, as the tally's bottom edge: one line, its words
 * under it when it is pointed at, focused or tapped.
 *
 * In people, not crops, while the queue serves every person's first crop
 * before anybody's second: the people whose date was read and compared, and
 * the people with a crop waiting on the site. The reader's own part is what
 * they read, in crops, so it overstates their share of the people, which is
 * the more rewarding figure to see grow (decision on 2026-11-19). It is drawn
 * at the end of the done part, where the progress is, in the tally's Oliwka:
 * at the start it would sit under the Oliwka pane and vanish into it.
 */
const props = defineProps<{
  people: DeclarationPeople;
  /** Crops this reader read: the tally's „Sprawdzono”. */
  yours: number;
}>();

const open = ref(false);

/** A touch has no "over", only the click that comes after it. */
function pointing(event: PointerEvent, over: boolean) {
  if (event.pointerType === "mouse") open.value = over;
}

/** Focus from the keyboard; a click focuses the line too, and opens it. */
function focused(event: FocusEvent) {
  if ((event.target as Element).matches(":focus-visible")) open.value = true;
}

const DONE = brand.primary;
const YOURS = role.tally;
const WAITING = ink.track;

/** A date read and compared, whatever came of it: published, held for an
 * admin, a namesake or a misreading to clear up. */
const done = computed(
  () =>
    props.people.published +
    props.people.held +
    props.people.namesakes +
    props.people.mismatched,
);
const waiting = computed(() => props.people.reading);

const parts = computed(() => {
  const yours = Math.min(props.yours, done.value);
  return [
    { key: "done", value: done.value - yours, color: DONE },
    { key: "yours", value: yours, color: YOURS },
    { key: "waiting", value: waiting.value, color: WAITING },
  ].filter((part) => part.value > 0);
});

const summary = computed(
  () =>
    `Gotowe osoby: ${polishNumber(done.value)} z ${polishNumber(
      done.value + waiting.value,
    )}. Twoje odczyty: ${polishNumber(props.yours)}.`,
);
</script>

<style scoped>
/* The tally's last row, across both of its columns. The line is 6px; what
   takes a pointer or a thumb is 22px, the rest of it reaching up over the
   tally's padding, which has nothing to click: the buttons in it end 22px
   above the tally's bottom on a phone. */
.reading-progress {
  background: none;
  border: 0;
  cursor: pointer;
  display: flex;
  gap: 2px;
  grid-column: 1 / -1;
  height: 6px;
  padding: 0;
  position: relative;
  width: 100%;
}

.reading-progress::before {
  bottom: 0;
  content: "";
  height: 22px;
  left: 0;
  position: absolute;
  right: 0;
}

.reading-progress:focus-visible {
  outline: 2px solid rgb(var(--v-theme-ink-sage));
  outline-offset: -2px;
}

.reading-progress__part {
  flex-basis: 0;
  min-width: 3px;
}

.reading-progress__line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 0;
}

.reading-progress__line + .reading-progress__line {
  margin-top: 4px;
}

.reading-progress__item {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.reading-progress__item strong {
  color: rgb(var(--v-theme-ink-strong));
  font-variant-numeric: tabular-nums;
}

.reading-progress__dot {
  border-radius: 50%;
  display: inline-block;
  flex: none;
  height: 10px;
  width: 10px;
}
</style>

<style>
/* The words under the line, on the tally's paper rather than in a dark
   tooltip: they read as the tally's, a line further down. Not scoped, as
   the overlay is moved out of the component. */
.v-tooltip > .v-overlay__content.reading-progress__tip {
  background: rgb(var(--v-theme-tally-pale));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  color: rgb(var(--v-theme-ink-neutral));
  font-size: 0.875rem;
  line-height: 1.5;
  padding: 8px 12px;
}
</style>

<template>
  <div
    class="revision-diff"
    :class="{ 'revision-diff--wide': wide }"
    data-testid="revision-diff"
  >
    <p v-if="unchanged" class="text-caption text-medium-emphasis mb-0">
      Wpis już to zawiera.
    </p>

    <template v-else>
      <div
        v-for="change in shown"
        :key="change.field"
        class="revision-diff__row text-body-2"
      >
        <span class="revision-diff__label text-medium-emphasis">{{
          change.label
        }}</span>
        <span
          class="revision-diff__value"
          :class="valueClass(change.from, 'from')"
          >{{ displayValue(change.from) }}</span
        >
        <v-icon :icon="mdiArrowRight" size="x-small" class="text-disabled" />
        <span
          class="revision-diff__value"
          :class="valueClass(change.to, 'to')"
          >{{ displayValue(change.to) }}</span
        >
      </div>

      <div v-if="hidden > 0 || fullComparisonTo" class="text-caption mt-1">
        <span v-if="hidden > 0" class="text-medium-emphasis">
          …i jeszcze {{ polishCounting(hidden, "pole", "pola", "pól") }}
        </span>
        <NuxtLink
          v-if="fullComparisonTo"
          :to="fullComparisonTo"
          class="text-ink-info ml-1"
        >
          Pełne porównanie
        </NuxtLink>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/** What a revision would change, as the few lines a reviewer has to decide on.
 *
 * A revision is a full snapshot, so rendering it whole buries the handful of
 * fields that differ - `revisionChanges` has already reduced it to those, and
 * this only has to read them out. The values arrive pre-rendered as text, with
 * `null` for a field that is absent and `""` for one a contributor deliberately
 * cleared; those are different claims and are shown as different words.
 */
import { computed } from "vue";
import { mdiArrowRight } from "@mdi/js";
import { MAX_INLINE_CHANGES } from "~~/shared/proposals";
import type { RevisionChange } from "~~/shared/revisionChanges";
import { polishCounting } from "~/composables/polish";

const props = withDefaults(
  defineProps<{
    changes: RevisionChange[];
    /** How many fields differ in total, which `changes` may be capped below. */
    changeCount: number;
    max?: number;
    /** Route to the side-by-side view, when the caller has one to offer. */
    fullComparisonTo?: string | null;
    /** Not squeezed into a table cell: let a long value take the line. */
    wide?: boolean;
  }>(),
  { max: MAX_INLINE_CHANGES, fullComparisonTo: null, wide: false },
);

const shown = computed(() => props.changes.slice(0, props.max));

// Counted against what is actually on screen rather than against `max`: the
// endpoint caps `changes` itself, so a row can arrive with fewer than `max`
// entries and still stand for more.
const hidden = computed(() =>
  Math.max(0, props.changeCount - shown.value.length),
);

const unchanged = computed(
  () => props.changes.length === 0 && props.changeCount === 0,
);

function displayValue(value: string | null): string {
  if (value === null) return "—";
  if (value === "") return "usunięto";
  return value;
}

function valueClass(value: string | null, side: "from" | "to"): string {
  if (value === null || value === "") return "revision-diff__empty";
  return side === "from" ? "revision-diff__from" : "revision-diff__to";
}
</script>

<style scoped>
.revision-diff__row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
}

.revision-diff__label::after {
  content: ":";
}

/* Capped and wrapping, because a `content` field runs to paragraphs and would
   otherwise stretch the table cell this sits in off the screen. */
.revision-diff__value {
  max-width: 220px;
  overflow-wrap: anywhere;
}

/* In an open history row there is no cell to protect, and a description held
   to 220px turned into a column a few words wide and a screen tall. Given the
   whole line, a long value wraps as prose and the arrow and the new value
   follow it on the next line. */
.revision-diff--wide .revision-diff__value {
  max-width: 100%;
  white-space: pre-line;
}

.revision-diff__from {
  text-decoration: line-through;
  opacity: 0.6;
}

.revision-diff__to {
  font-weight: 500;
}

.revision-diff__empty {
  font-style: italic;
  opacity: 0.6;
}
</style>

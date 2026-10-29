<template>
  <span class="dcmp" :data-difference="comparison?.kind ?? 'no-date'">
    <span class="d-sr-only">{{ spoken }}</span>
    <span class="dcmp__date" aria-hidden="true">
      <template v-if="comparison">
        <template v-for="(c, i) in comparison.reading" :key="i">
          <mark v-if="c.differs" class="dcmp__diff">{{ c.char }}</mark>
          <template v-else>{{ c.char }}</template>
        </template>
      </template>
      <template v-else>{{ declarationDateText(reading) }}</template>
    </span>
    <span class="dcmp__vs" aria-hidden="true">{{
      !comparison ? "·" : comparison.kind === "same" ? "=" : "≠"
    }}</span>
    <span class="dcmp__date dcmp__date--page" aria-hidden="true">
      <template v-if="comparison">
        <template v-for="(c, i) in comparison.stored" :key="i">
          <mark v-if="c.differs" class="dcmp__diff">{{ c.char }}</mark>
          <template v-else>{{ c.char }}</template>
        </template>
      </template>
      <template v-else>strona bez daty</template>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  compareDeclarationDates,
  declarationDateText,
} from "~/utils/declarationsAdmin";

/** The reading readers agreed on beside the date the page stores, with the
 * characters that differ marked in both.
 *
 * Which ones differ is most of the decision: a single digit is usually the
 * crop misread or mistyped on the page, a whole year usually somebody else's
 * declaration. Printed the way the page prints dates, in figures of one width,
 * so the marks line up row under row. */
const props = defineProps<{
  /** The agreed reading, `YYYY-MM-DD` or `YYYY`. */
  reading: string;
  /** The page's date, or null for a page without one. */
  stored: string | null;
}>();

const comparison = computed(() =>
  compareDeclarationDates(props.reading, props.stored),
);

const spoken = computed(() =>
  props.stored
    ? `odczyt ${declarationDateText(props.reading)}, na stronie ${declarationDateText(props.stored)}`
    : `odczyt ${declarationDateText(props.reading)}, strona bez daty`,
);
</script>

<style scoped>
.dcmp {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dcmp__date {
  font-weight: 600;
}

/* The page's date is the one being checked against, so it steps back. */
.dcmp__date--page {
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.dcmp__vs {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.dcmp__diff {
  padding: 0 1px;
  border-radius: 2px;
  background: rgb(var(--v-theme-surface-danger));
  color: rgb(var(--v-theme-ink-danger));
  font-weight: 700;
}
</style>

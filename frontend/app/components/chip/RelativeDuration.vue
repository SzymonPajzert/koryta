<template>
  <div class="d-flex flex-column align-center" :class="{ 'w-100': bare }">
    <!-- `bare`: the track alone, as wide as its column, on the quiet .10 tint
         rather than Vuetify's dark surface-variant - where the caller prints
         the period itself, beside the bar, the bar is the background to the
         dates and should not be darker than the period it marks. -->
    <div
      class="relative-duration-wrapper rounded-pill flex-shrink-0"
      :class="bare ? 'relative-duration--bare' : 'bg-surface-variant'"
      :style="{
        height: '6px',
        width: bare ? '100%' : '200px',
        position: 'relative',
        overflow: 'hidden',
      }"
    >
      <div
        class="bg-success rounded-pill"
        :style="{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `calc(min(${leftPercent}%, 100% - 6px))`,
          width: `${widthPercent}%`,
          minWidth: '6px',
        }"
      />
    </div>
    <span v-if="!bare" class="text-caption">{{ description }}</span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { relationPeriodLabel } from "~/utils/relationPeriod";

const props = defineProps<{
  start: string | undefined;
  end: string | undefined;
  minStart: string | undefined;
  maxEnd: string | undefined;
  /** The bar without its caption, filling its parent: for a caller that
   * prints the period in a column of its own. */
  bare?: boolean;
}>();

// Shared with the phone layout of `card/EmploymentHistory.vue`, which shows the
// period on its own where this bar will not fit.
const description = computed(() => relationPeriodLabel(props.start, props.end));

const parseDate = (d: string | undefined, fallback: number) => {
  if (!d) return fallback;
  const date = new Date(d);
  if (isNaN(date.getTime())) return fallback;
  return date.getTime();
};

const leftPercent = computed(() => {
  const now = Date.now();
  // Assume one year default duration if min/max are missing entirely
  const defaultMin = now - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now);
  const start = parseDate(props.start, min); // if no start, it starts from min

  if (min >= max) return 0;

  const offset = start - min;
  return Math.max(0, Math.min(100, (offset / (max - min)) * 100));
});

const widthPercent = computed(() => {
  const now = Date.now();
  const defaultMin = now - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now);

  const start = parseDate(props.start, min);
  const end = parseDate(props.end, now); // if no end, it goes to now

  if (min >= max) return 100;

  const width = end - start;
  return Math.max(0, Math.min(100, (width / (max - min)) * 100));
});
</script>

<style scoped>
.relative-duration--bare {
  background: rgba(var(--v-theme-on-surface), 0.1);
}
</style>

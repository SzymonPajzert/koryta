<template>
  <div class="d-flex flex-column align-center">
    <div
      class="relative-duration-wrapper bg-surface-variant rounded-pill flex-shrink-0"
      style="height: 6px; width: 200px; position: relative; overflow: hidden"
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
    <span class="text-caption">{{ description }}</span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { periodLabel } from "~/utils/period";

const props = defineProps<{
  start: string | undefined;
  end: string | undefined;
  minStart: string | undefined;
  maxEnd: string | undefined;
}>();

// The wording lives in `~/utils/period` rather than here: the employment row
// prints the same period as text below md, where this bar is hidden, and the
// two must not be able to disagree about what a missing start reads as.
const description = computed(() => periodLabel(props.start, props.end));

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

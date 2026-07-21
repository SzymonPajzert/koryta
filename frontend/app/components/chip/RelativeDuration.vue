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

const props = defineProps<{
  start: string | undefined;
  end: string | undefined;
  minStart: string | undefined;
  maxEnd: string | undefined;
}>();

const description = computed(() => {
  if (props.start && props.end && props.start == props.end) {
    return props.start;
  } else {
    return `${props.start} - ${props.end || "obecnie"}`;
  }
});

const parseDate = (d: string | undefined, fallback: number) => {
  if (!d) return fallback;
  const date = new Date(d);
  if (isNaN(date.getTime())) return fallback;
  return date.getTime();
};

// useState to avoid hydration mismatch between the server and client.
const now = useState("relative-duration-now", () => Date.now());

const leftPercent = computed(() => {
  // Assume one year default duration if min/max are missing entirely
  const defaultMin = now.value - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now.value);
  const start = parseDate(props.start, min); // if no start, it starts from min

  if (min >= max) return 0;

  const offset = start - min;
  return Math.max(0, Math.min(100, (offset / (max - min)) * 100));
});

const widthPercent = computed(() => {
  const defaultMin = now.value - 31536000000;

  const min = parseDate(props.minStart, defaultMin);
  const max = parseDate(props.maxEnd, now.value);

  const start = parseDate(props.start, min);
  const end = parseDate(props.end, now.value); // if no end, it goes to now

  if (min >= max) return 100;

  const width = end - start;
  return Math.max(0, Math.min(100, (width / (max - min)) * 100));
});
</script>

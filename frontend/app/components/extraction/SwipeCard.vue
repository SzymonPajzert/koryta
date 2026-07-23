<template>
  <div
    class="swipe-card-wrapper"
    @touchstart.passive="onStart"
    @touchmove.passive="onMove"
    @touchend="onEnd"
    @mousedown="onStart"
    @mousemove="onMove"
    @mouseup="onEnd"
    @mouseleave="onEnd"
  >
    <div
      class="swipe-card"
      :class="{ 'swipe-card--animating': animating }"
      :style="{
        transform: `translateX(${offset}px) rotate(${rotation}deg)`,
      }"
    >
      <!-- Swipe indicators -->
      <div
        class="swipe-indicator swipe-indicator--right"
        :style="{ opacity: rightOpacity }"
      >
        <v-icon color="success" size="48">{{ mdiCheckCircle }}</v-icon>
      </div>
      <div
        class="swipe-indicator swipe-indicator--left"
        :style="{ opacity: leftOpacity }"
      >
        <v-icon color="error" size="48">{{ mdiCloseCircle }}</v-icon>
      </div>

      <!-- Overlays -->
      <div
        class="swipe-overlay swipe-overlay--green"
        :style="{ opacity: rightOpacity * 0.15 }"
      />
      <div
        class="swipe-overlay swipe-overlay--red"
        :style="{ opacity: leftOpacity * 0.15 }"
      />

      <ExtractionCard :fact="fact" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { mdiCheckCircle, mdiCloseCircle } from "@mdi/js";
import type { ExtractionFact } from "~~/shared/model";

const { fact } = defineProps<{
  fact: ExtractionFact;
}>();

const emit = defineEmits<{
  swiped: [direction: "left" | "right"];
}>();

const FEEDBACK_THRESHOLD = 50;
const SWIPE_THRESHOLD = 100;

const dragging = ref(false);
const startX = ref(0);
const offset = ref(0);
const animating = ref(false);

const rotation = computed(() => offset.value * 0.08);
const rightOpacity = computed(() =>
  Math.min(
    Math.max(offset.value - FEEDBACK_THRESHOLD, 0) / FEEDBACK_THRESHOLD,
    1,
  ),
);
const leftOpacity = computed(() =>
  Math.min(
    Math.max(-offset.value - FEEDBACK_THRESHOLD, 0) / FEEDBACK_THRESHOLD,
    1,
  ),
);

function getClientX(e: MouseEvent | TouchEvent): number {
  if ("touches" in e) return e.touches[0]?.clientX ?? 0;
  return e.clientX;
}

function onStart(e: MouseEvent | TouchEvent) {
  dragging.value = true;
  animating.value = false;
  startX.value = getClientX(e);
}

function onMove(e: MouseEvent | TouchEvent) {
  if (!dragging.value) return;
  offset.value = getClientX(e) - startX.value;
}

function onEnd() {
  if (!dragging.value) return;
  dragging.value = false;

  if (Math.abs(offset.value) >= SWIPE_THRESHOLD) {
    const direction = offset.value > 0 ? "right" : "left";
    const flyTo = direction === "right" ? 600 : -600;
    animating.value = true;
    offset.value = flyTo;

    setTimeout(() => {
      emit("swiped", direction);
      // Reset position for next card
      animating.value = false;
      offset.value = 0;
    }, 300);
  } else {
    // Spring back
    animating.value = true;
    offset.value = 0;
    setTimeout(() => {
      animating.value = false;
    }, 300);
  }
}
</script>

<style scoped>
.swipe-card-wrapper {
  position: relative;
  user-select: none;
  cursor: grab;
  touch-action: pan-y;
}

.swipe-card-wrapper:active {
  cursor: grabbing;
}

.swipe-card {
  position: relative;
  will-change: transform;
}

.swipe-card--animating {
  transition: transform 0.3s ease-out;
}

.swipe-indicator {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  pointer-events: none;
}

.swipe-indicator--right {
  left: 16px;
}

.swipe-indicator--left {
  right: 16px;
}

.swipe-overlay {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  z-index: 1;
  pointer-events: none;
}

.swipe-overlay--green {
  background-color: rgb(var(--v-theme-success));
}

.swipe-overlay--red {
  background-color: rgb(var(--v-theme-error));
}
</style>

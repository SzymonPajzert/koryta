<template>
  <div class="chart-container">
    <div class="stack-bar-container">
      <v-tooltip
        v-for="(segment, index) in segments"
        :key="index"
        :text="segment.label"
        location="bottom"
      >
        <template #activator="{ props }">
          <div
            v-bind="props"
            class="stack-bar-segment"
            :style="{
              width: (segment.value / total) * 100 + '%',
              backgroundColor: segment.color,
            }"
          >
            {{ segment.value }}
          </div>
        </template>
      </v-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Segment {
  value: number;
  color: string;
  label: string;
}

const segments: Segment[] = [
  { value: 200, color: "#4caf50", label: "Dodane" },
  { value: 100, color: "#2196f3", label: "Do sprawdzenia" },
  { value: 431, color: "#f44336", label: "Znalezione" },
];

// Calculate the total value of all segments
const total = computed(() =>
  segments.reduce((sum, segment) => sum + segment.value, 0),
);
</script>

<style scoped>
.chart-container {
  font-family: "Inter", sans-serif;
  width: 100%;
  max-width: 800px;
}

.stack-bar-container {
  display: flex;
  width: 100%;
  height: 2.5rem; /* 40px */
  border-radius: 0.75rem; /* 12px */
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.stack-bar-segment {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: white;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.3s ease;
}

.stack-bar-segment:not(:last-child) {
  border-right: 1px solid rgba(0, 0, 0, 0.1);
}

.stack-bar-segment:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
  z-index: 10;
}
</style>

<template>
  <div>
    <div class="composition-bar" role="img" :aria-label="summary">
      <v-tooltip
        v-for="segment in visible"
        :key="segment.key"
        :text="`${segment.label}: ${formatCount(segment.value)} (${formatPercent(segment.value, total)})`"
        location="bottom"
      >
        <template #activator="{ props: tooltipProps }">
          <component
            :is="segment.to ? 'NuxtLink' : 'div'"
            v-bind="tooltipProps"
            :to="segment.to"
            class="composition-bar__segment"
            :style="{
              width: (segment.value / total) * 100 + '%',
              backgroundColor: segment.color,
            }"
          >
            <!-- Only label a segment that the text actually fits inside;
                 anything narrower keeps its value in the legend and tooltip
                 rather than being clipped. -->
            <span
              v-if="segment.value / total > 0.09"
              class="composition-bar__value"
              :style="{ color: segment.labelColor ?? '#ffffff' }"
            >
              {{ formatCount(segment.value) }}
            </span>
          </component>
        </template>
      </v-tooltip>
    </div>

    <div class="d-flex flex-wrap ga-4 mt-2">
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="text-body-2 text-medium-emphasis d-flex align-center"
      >
        <span
          class="composition-bar__dot mr-1"
          :style="{ backgroundColor: segment.color }"
        />
        {{ segment.label }}:
        <strong class="ms-1 text-high-emphasis">{{
          formatCount(segment.value)
        }}</strong>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { formatCount, formatPercent } from "~/utils/chartTheme";

export type CompositionSegment = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Ink for the value drawn inside the fill; pick by the fill's luminance. */
  labelColor?: string;
  to?: string;
};

/** A part-to-whole bar: one row, segments in the surface-gapped stack the
 * method prescribes, and a legend that always carries the numbers so identity
 * never rests on colour alone. */
const props = defineProps<{
  segments: CompositionSegment[];
  /** Read out to a screen reader in place of the bar. */
  summary: string;
}>();

const total = computed(
  () => props.segments.reduce((sum, s) => sum + s.value, 0) || 1,
);

/** A zero-width segment still draws its min-width sliver and its gap, so an
 * empty bucket is dropped from the bar - the legend still lists it. */
const visible = computed(() => props.segments.filter((s) => s.value > 0));
</script>

<style scoped>
.composition-bar {
  display: flex;
  width: 100%;
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
}

.composition-bar__segment {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 3px;
  text-decoration: none;
  transition: width 0.3s ease;
}

/* The 2px gap in the surface colour is what separates touching fills - never
   a border drawn around them. */
.composition-bar__segment:not(:last-child) {
  margin-right: 2px;
}

.composition-bar__value {
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* The 9% threshold above is a proportion, and a proportion is not a width: on a
   375px phone a segment can clear it and still be ~45px wide, which is less
   than the four tabular figures printed inside it. The legend under the bar
   carries every number anyway, so on a phone the bar is only the shape.

   A media query rather than `useDisplay()`, because the breakpoint composable
   resolves to the desktop default during SSR and the numbers would appear in
   the server's markup and vanish on hydration. */
@media (max-width: 599px) {
  .composition-bar__value {
    display: none;
  }
}

.composition-bar__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}
</style>

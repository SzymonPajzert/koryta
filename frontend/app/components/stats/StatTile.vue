<template>
  <!-- The imported NuxtLink, not the string 'NuxtLink': a string handed to
       `:is` is looked up at render time among the globally registered
       components, which NuxtLink is not, so a tile with a `to` rendered as an
       inert <nuxtlink> tag with no href. -->
  <component
    :is="to ? NuxtLink : 'div'"
    :to="to"
    class="stat-tile d-block text-decoration-none"
    :class="{ 'stat-tile--link': to }"
  >
    <div class="d-flex align-center ga-2 mb-1">
      <span
        v-if="color"
        class="stat-tile__dot"
        :style="{ backgroundColor: color }"
        aria-hidden="true"
      />
      <span class="text-caption text-medium-emphasis">
        {{ label }}
        <v-tooltip v-if="tooltip" activator="parent" location="bottom">
          {{ tooltip }}
        </v-tooltip>
      </span>
    </div>
    <div class="stat-tile__value">{{ formatCompact(value) }}</div>
    <div v-if="hint" class="text-caption text-medium-emphasis mt-1">
      {{ hint }}
    </div>
  </component>
</template>

<script setup lang="ts">
import { NuxtLink } from "#components";
import { formatCompact } from "~/utils/chartTheme";

/** A single headline number. The method's answer to a one-bar bar chart: when
 * the data is one value, the number is the chart.
 *
 * `color` is the dot beside the label, not the text - identity comes from a
 * coloured mark next to the words, never from colouring the words. */
defineProps<{
  label: string;
  value: number | null | undefined;
  /** A short line under the value. Anything longer belongs in `tooltip`. */
  hint?: string;
  /** The full explanation, for a term the reader is meeting for the first time. */
  tooltip?: string;
  /** Series colour of whatever this tile counts, if it appears in a chart too. */
  color?: string;
  to?: string;
}>();
</script>

<style scoped>
.stat-tile {
  color: inherit;
}

.stat-tile__value {
  /* Proportional figures on purpose: tabular-nums makes a large standalone
     number look loose. Columns of numbers get tabular-nums, tiles do not. */
  font-size: 1.75rem;
  line-height: 1.15;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.stat-tile__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.stat-tile--link:hover .stat-tile__value {
  text-decoration: underline;
}
</style>

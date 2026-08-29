<template>
  <div class="chart-container">
    <div class="stack-bar-container">
      <v-tooltip
        v-for="(segment, index) in segments"
        :key="index"
        :text="`${segment.label}: ${segment.value}`"
        location="bottom"
      >
        <template #activator="{ props }">
          <NuxtLink
            v-bind="props"
            :to="segment.link"
            class="stack-bar-segment"
            :aria-label="`${segment.label}: ${segment.value}`"
            :style="{
              width: (segment.value / total) * 100 + '%',
              backgroundColor: segment.color,
            }"
          >
            <!-- The count only exists above md, and hiding it is what fixes
                 the report („liczby są mocno ściśnięte"). Inside the home
                 page's padding the bar is 311px at 375px wide, and the live
                 figures split it 39 / 22 / 250px. A flex item's default
                 `min-width: auto` is its min-content, which here is the width
                 of its own digits - so the middle segment could not be
                 narrower than "513" and took the difference out of its
                 neighbours, leaving six digits crammed into ~64px of bar. With
                 the only child `display: none` the min-content is 0 and the
                 three widths are finally the three shares. A `min-width` floor
                 of the kind ExploreProgressBar carries would undo that, and
                 would also give the seeded zero-value segment a sliver it does
                 not have today. -->
            <span class="d-none d-md-inline">{{ segment.value }}</span>
          </NuxtLink>
        </template>
      </v-tooltip>
    </div>

    <!-- Where the figures go instead. They were only ever named by the tooltip
         above, whose activator is a link: on a touch screen the tap navigates
         rather than revealing anything, so a phone reader met three bare
         integers in tap targets 22-39px wide. A row apiece gives each one a
         name, a colour to tie it to its slice of the bar, and a target worth
         aiming at. `text-start` because CardCallToAction centres everything
         inside it and a two-column list has to line up. -->
    <ul class="progress-legend d-md-none mt-3 pa-0 text-start">
      <li v-for="segment in segments" :key="segment.label">
        <NuxtLink
          :to="segment.link"
          class="d-flex align-center ga-2 py-2 text-body-2 text-medium-emphasis"
        >
          <span class="legend-dot" :style="{ background: segment.color }" />
          <span>{{ segment.label }}</span>
          <!-- Raw, not `toLocaleString("pl-PL")`: Node and Chromium disagree
               about which no-break space groups the thousands, which is a
               hydration mismatch on the busiest page of the site. -->
          <span class="ms-auto font-weight-medium">{{ segment.value }}</span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStats } from "~/composables/stats/useStats";

interface Segment {
  value: number;
  color: string;
  label: string;
  link: string;
}

const { approved, reviewed, toCheck } = useStats();

// The labels are the ones ExploreProgressBar uses for the same three figures.
// They were "Dodane" and "Ciekawe", the latter left over from when the field
// was called `interesting`, and until now they were only ever read off a hover
// tooltip - so nobody on a phone had seen either of them. They are the legend's
// text now, which is reason enough for them to say what the numbers mean.
const segments = computed<Segment[]>(() => [
  {
    value: approved.value,
    color: "#4caf50",
    label: "Opublikowane",
    link: "/eksploruj/tabela",
  },
  {
    value: reviewed.value,
    color: "#2196f3",
    label: "Sprawdzone",
    link: "/pomoc",
  },
  {
    value: toCheck.value,
    color: "#f44336",
    label: "Do sprawdzenia",
    link: "/eksploruj/tabela?visibility=private",
  },
]);

// Calculate the total value of all segments. Floored at 1 so the widths below
// stay numbers for the frame before the counts arrive.
const total = computed(() =>
  Math.max(
    segments.value.reduce((sum, segment) => sum + segment.value, 0),
    1,
  ),
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
  text-decoration: none;
}

.stack-bar-segment:not(:last-child) {
  border-right: 1px solid rgba(0, 0, 0, 0.1);
}

.stack-bar-segment:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
  z-index: 10;
}

.progress-legend {
  list-style: none;
  /* The browser's own 1em block margin on a `ul`, which would put an
     unexplained gap between the bar and the first row and another one under
     the last. `mt-3` in the template is `!important` and still wins for the
     top. */
  margin-block: 0;
}

.progress-legend a {
  color: inherit;
  text-decoration: none;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 959.98px is Vuetify's own md boundary - the width `d-md-none` above switches
   at - so the bar and the legend can never both be on screen or both be off
   it. 40px of empty colour is a slab once there is nothing written inside it;
   at 24px the existing 12px radius makes it the pill it is described as. */
@media (max-width: 959.98px) {
  .stack-bar-container {
    height: 1.5rem; /* 24px */
  }
}
</style>

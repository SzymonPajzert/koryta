<template>
  <v-card
    border
    class="pt-2 mt-2 mx-auto"
    data-testid="home-timeline-controls"
    max-width="400"
    rounded="lg"
  >
    <v-card-title class="text-subtitle-1 font-weight-medium">
      Ustawienia wykresu
    </v-card-title>
    <v-divider />

    <v-card-text>
      <div class="text-body-2 text-medium-emphasis mb-2">Zakres czasu</div>
      <v-btn-toggle
        v-model="range"
        data-testid="home-timeline-range"
        density="compact"
        divided
        mandatory
        rounded="lg"
        variant="outlined"
      >
        <v-btn
          v-for="option in timelineRanges"
          :key="option.value"
          class="text-none"
          size="small"
          :text="option.label"
          :value="option.value"
        />
      </v-btn-toggle>

      <!-- Radios rather than a second button group: the three are a question
           („czym dzielimy?”) with one answer and a sentence of explanation
           each, and a row of buttons has nowhere to put the sentence. -->
      <v-radio-group
        v-model="grouping"
        class="mt-4"
        data-testid="home-timeline-grouping"
        density="compact"
        hide-details
      >
        <template #label>
          <span class="text-body-2 text-medium-emphasis">Podział</span>
        </template>
        <v-radio
          v-for="option in timelineGroupingOptions"
          :key="option.value"
          :value="option.value"
        >
          <template #label>
            <div>
              <div>{{ option.label }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ option.hint }}
              </div>
            </div>
          </template>
        </v-radio>
      </v-radio-group>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import {
  timelineGroupingOptions,
  timelineRanges,
  type TimelineRange,
} from "~/composables/homeTimeline";
import type { TimelineGrouping } from "~~/server/api/stats/homeTimeline.get";

/** The timeline's controls, which live in the explorer's side panel while the
 * chart they drive fills the panel beside it.
 *
 * Two `defineModel`s rather than one settings object: the parent holds them as
 * separate refs because a change of grouping is worth counting and a change of
 * range is worth counting separately.
 */
const range = defineModel<TimelineRange>("range", { required: true });
const grouping = defineModel<TimelineGrouping>("grouping", { required: true });
</script>

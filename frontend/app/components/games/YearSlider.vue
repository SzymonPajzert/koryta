<template>
  <div>
    <!-- The readout between two steppers, and the drag underneath.
         The steppers are not a nicety - they are what makes this playable on a
         phone. Twenty-seven years across a 375px screen is about eleven pixels
         a year against a fingertip nearer forty, and the scoring pays full
         marks only for the exact year: without a way to land on one deliberately
         the game would be asking for a precision the control cannot give. So
         drag to get close, tap to arrive. -->
    <div class="d-flex align-center justify-center ga-3 mb-1">
      <v-btn
        :icon="mdiMinus"
        variant="tonal"
        size="large"
        :disabled="disabled || model <= min"
        aria-label="Rok wcześniej"
        data-testid="year-slider-down"
        @click="nudge(-1)"
      />
      <div class="d-flex align-baseline ga-2 year-readout justify-center">
        <span class="text-h3 font-weight-bold" data-testid="year-slider-value">
          {{ model }}
        </span>
        <span class="text-body-2 text-medium-emphasis">rok</span>
      </div>
      <v-btn
        :icon="mdiPlus"
        variant="tonal"
        size="large"
        :disabled="disabled || model >= max"
        aria-label="Rok później"
        data-testid="year-slider-up"
        @click="nudge(1)"
      />
    </div>

    <!-- `track-size` and the thumb are both bigger than Vuetify's defaults: the
         thumb is what a thumb has to catch, and the track is what it has to
         catch it on. -->
    <v-slider
      v-model="model"
      :min="min"
      :max="max"
      :step="1"
      :disabled="disabled"
      color="primary"
      track-size="8"
      thumb-size="28"
      hide-details
      data-testid="year-slider"
      :aria-label="`Rok: ${model}`"
    />

    <!-- The ends of the axis, so the travel is legible before the first drag.
         Not v-slider's own tick labels: at one tick a year they collapse into
         a grey smear, and at ten they suggest the answer is a round year. -->
    <div class="d-flex justify-space-between text-caption text-medium-emphasis">
      <span>{{ min }}</span>
      <span>{{ max }}</span>
    </div>

    <!-- Where the answers already landed. The doc's own note on this game:
         every round marks up one shared axis, so the end screen is a history
         of the revolving door the player drew themselves. -->
    <div v-if="marks.length" class="marks mt-3" data-testid="year-slider-marks">
      <div
        v-for="mark in placed"
        :key="mark.key"
        class="marks__pin"
        :class="{ 'marks__pin--miss': mark.missed }"
        :style="{ left: `${mark.percent}%` }"
        :title="mark.title"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { mdiMinus, mdiPlus } from "@mdi/js";

/** A year on an axis, and the years already answered on the same axis.
 *
 * The first slider in this codebase, so it is worth saying what it is for
 * rather than only what it does: every "how close were you" daily on the
 * roadmap - the handover dates here, asset declarations later - needs one
 * control that turns a continuous quantity into a guess, and needs the guesses
 * to accumulate somewhere the player can read. Keeping both here means the
 * next such game inherits the second half for free.
 */
const model = defineModel<number>({ required: true });

const props = defineProps<{
  min: number;
  max: number;
  disabled?: boolean;
  /** Rounds already answered, drawn as pins under the track. */
  marks?: { key: string; year: number; missed?: boolean; title?: string }[];
}>();

const marks = computed(() => props.marks ?? []);

/** One year either way, clamped to the axis. Separate from the slider's own
 * keyboard stepping because the buttons have to work under a finger, which is
 * the case the slider does not cover. */
function nudge(by: number) {
  if (props.disabled) return;
  model.value = Math.min(props.max, Math.max(props.min, model.value + by));
}

/** A year as a position along the track.
 *
 * Clamped rather than trusted: a mark outside the axis would be drawn off the
 * end of its container, and an axis that does not cover its own data is a bug
 * worth seeing pinned at the edge rather than one that silently disappears.
 */
const placed = computed(() =>
  marks.value.map((mark) => {
    const span = Math.max(1, props.max - props.min);
    const ratio = (mark.year - props.min) / span;
    return {
      ...mark,
      percent: Math.min(100, Math.max(0, ratio * 100)),
    };
  }),
);
</script>

<style scoped>
/* Fixed, so that the two steppers stay where the thumb left them: without it
   every change of digit width moves both buttons under the finger. */
.year-readout {
  min-width: 9ch;
}

.marks {
  height: 14px;
  position: relative;
}

.marks__pin {
  background: rgb(var(--v-theme-primary));
  border-radius: 2px;
  height: 12px;
  margin-left: -2px;
  position: absolute;
  top: 0;
  width: 4px;
}

/* A round the player did not land. Same axis, different weight - the point of
   the strip is the shape of the day, not a scoreboard. */
.marks__pin--miss {
  background: rgba(var(--v-theme-on-surface), 0.3);
}
</style>

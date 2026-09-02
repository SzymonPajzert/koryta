<template>
  <div>
    <div class="d-flex align-baseline justify-center ga-2 mb-1">
      <span class="text-h3 font-weight-bold" data-testid="year-slider-value">
        {{ model }}
      </span>
      <span class="text-body-2 text-medium-emphasis">rok</span>
    </div>

    <v-slider
      v-model="model"
      :min="min"
      :max="max"
      :step="1"
      :disabled="disabled"
      color="primary"
      track-size="6"
      thumb-size="22"
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

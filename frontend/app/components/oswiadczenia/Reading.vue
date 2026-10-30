<template>
  <!-- Polite, so a screen reader hears the date it typed said back without
       being cut off mid-word by the next key. -->
  <p
    class="ow-reading"
    :class="[`ow-reading--${tone}`, { 'ow-reading--compact': compact }]"
    aria-live="polite"
    data-testid="declaration-reading"
  >
    <v-icon
      v-if="tone === 'ok'"
      :icon="mdiCheck"
      size="16"
      class="ow-reading__icon"
    />
    <span>{{ words }}</span>
  </p>
</template>

<script setup lang="ts">
import { mdiCheck } from "@mdi/js";
import { readTyped } from "~/utils/declarationReading";

/** The line under a date field that says back what it understood: „15 lipca
 * 1979”, „tylko rok: 1979”, or why what was typed is not a date.
 *
 * A problem is said once the text looks finished, or once the reader tried to
 * save it - not on every key of a date still being typed, when it would only
 * flicker. Until then the line is empty: the field's own „dd.mm.rrrr” says
 * how to type a date, and no examples stand under the field. */
const props = withDefaults(
  defineProps<{
    text: string;
    /** The reader pressed Zapisz: a problem now stops the save, so it says
     * so in the danger ink rather than as a hint. */
    attempted?: boolean;
    compact?: boolean;
  }>(),
  { attempted: false, compact: false },
);

const reading = computed(() => readTyped(props.text));

const tone = computed<"idle" | "ok" | "hint" | "error">(() => {
  const r = reading.value;
  if (r.state === "ok") return "ok";
  if (r.state === "empty") return "idle";
  if (props.attempted) return "error";
  if (r.state === "problem" && r.settled) return "hint";
  return "idle";
});

const words = computed(() => {
  const r = reading.value;
  if (r.state === "ok") return r.words;
  // Nothing typed is no problem: the button skips the crop then.
  if (r.state === "empty" || tone.value === "idle") return "";
  return r.words;
});
</script>

<style scoped>
.ow-reading {
  align-items: center;
  color: rgb(var(--v-theme-ink-neutral));
  display: flex;
  font-size: 0.875rem;
  gap: 6px;
  line-height: 1.25rem;
  margin: 0;
  min-height: 1.25rem;
}

.ow-reading--compact {
  font-size: 0.8125rem;
}

.ow-reading--ok {
  color: rgb(var(--v-theme-ink-strong));
  font-weight: 500;
}

.ow-reading__icon {
  color: rgb(var(--v-theme-ink-success));
}

.ow-reading--error {
  color: rgb(var(--v-theme-ink-danger));
}
</style>

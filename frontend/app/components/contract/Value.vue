<template>
  <span class="contract-value">
    <span
      class="contract-value__figure"
      :title="exact"
      :aria-label="exact"
      :tabindex="basisTooltip ? 0 : undefined"
      :role="basisTooltip ? 'button' : undefined"
    >
      {{ label }}
      <!-- `open-on-click`, like `PageSection`'s „(i)”: a phone never hovers,
           and the legal basis is the only thing on the row that explains why
           there is no figure. -->
      <v-tooltip
        v-if="basisTooltip"
        activator="parent"
        location="bottom start"
        max-width="320"
        open-on-click
      >
        Podstawa wyłączenia jawności: {{ basisTooltip }}
      </v-tooltip>
    </span>

    <!-- Beside the figure, never instead of it. Five of the 149 683 contracts
         carry the redaction flag *and* state a value, and `contractValueLabel`
         prefers the figure on purpose - the register answered, so the flag is
         not evidence that it did not. Hiding the number there would be this
         site editing the register; printing it without the basis would hide
         that the register held something back. -->
    <span v-if="basisBeside" class="text-caption text-ink-neutral">
      zastrzeżenie: {{ basisBeside }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { contractValueLabel, plnCompact, plnExact } from "~~/shared/money";
import type { ContractRedaction } from "~~/shared/contracts";

/** What a contract is worth, or why it does not say.
 *
 * Every figure on this feature goes through `shared/money.ts`, which is the
 * site's only currency formatter and says so in its own docstring - nothing
 * here formats a number itself. What this component adds is the half that is
 * not a number: a redaction is a separate question from a missing value, and
 * the two combine four ways, so they are answered here once rather than in the
 * three templates that print a contract's value.
 */
const props = defineProps<{
  value?: number | null;
  redaction?: ContractRedaction | null;
  /** „46,9 mln zł” rather than „46 903 118 zł”, for a heading or a strip where
   * the exact figure would wrap. The exact one is still on the element, as
   * `title` and as the accessible name. */
  compact?: boolean;
}>();

const hasFigure = computed(
  () =>
    props.value !== null &&
    props.value !== undefined &&
    Number.isFinite(props.value),
);

const label = computed(() =>
  props.compact && hasFigure.value
    ? plnCompact(props.value)
    : contractValueLabel(props.value, !!props.redaction),
);

/** The full figure, for a screen reader and for a hover.
 *
 * Only where there is one. `plnExact` answers „—” for a missing value, and an
 * `aria-label` of „—” would replace „Bez podanej wartości” - the one wording
 * that says what actually happened - with a dash. So the attribute is left off
 * entirely there and the visible text is the accessible name, which is already
 * the whole truth.
 */
const exact = computed(() =>
  hasFigure.value ? plnExact(props.value) : undefined,
);

const basisBeside = computed(() =>
  hasFigure.value ? (props.redaction?.basis ?? undefined) : undefined,
);

const basisTooltip = computed(() =>
  hasFigure.value ? undefined : (props.redaction?.basis ?? undefined),
);
</script>

<style scoped>
.contract-value {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* The neutral pill `card/Employment.vue` draws a period in. Deliberately not a
   `v-chip` and deliberately not tinted: sage is the colour this site marks its
   own claims in, and a contract's value is the register's claim, not ours. */
.contract-value__figure {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.6;
  padding: 0 6px;
  white-space: nowrap;
}

.contract-value__figure[role="button"] {
  cursor: pointer;
}
</style>

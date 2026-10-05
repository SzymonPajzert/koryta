<template>
  <v-chip
    v-if="voters > 0"
    :color="badge.color"
    :prepend-icon="badge.icon"
    size="x-small"
    variant="tonal"
    data-testid="extraction-vote-count"
  >
    {{ badge.label }} · {{ polishCounting(voters, ...VOTE_FORMS) }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import type { FactReviewState } from "~/utils/extraction";
import { polishCounting } from "~/composables/polish";

/** Told rather than asked: a card works these out from its one fact
 * (`factReviewState`, `factVoterCount`), a line on a person's page from every
 * article its claim was read from (`factGroupState`, `factGroupVoters`). */
const { state, voters } = defineProps<{
  /** Where the fact stands with the people who have looked at it. */
  state: FactReviewState;
  /** How many of them there are. Nothing is drawn at 0.
   *
   * A card that says „0 głosów" on every fact of a review queue is a column of
   * noise; silence already means „nobody has looked at this", and on a
   * person's page the heading over the unconfirmed block says it in words. */
  voters: number;
}>();

/** Singular, plural and genitive plural, as `polishCounting` takes them. */
const VOTE_FORMS: [string, string, string] = ["głos", "głosy", "głosów"];

/* The `ink-*` tokens rather than Vuetify's `success`/`warning`: those are
   picked as fills and measure 2.78:1 and 2.37:1 as text, which is under what
   even an icon needs. `composables/votes.ts` carries the measurements. */
const BADGES = {
  confirmed: {
    label: "Potwierdzony",
    color: "ink-success",
    icon: mdiCheckCircleOutline,
  },
  disputed: {
    label: "Zakwestionowany",
    color: "ink-warning",
    icon: mdiAlertCircleOutline,
  },
  // Somebody voted and it settled nothing - two readers who disagree, or one
  // who could not tell from the quote.
  unreviewed: {
    label: "Bez rozstrzygnięcia",
    color: "ink-neutral",
    icon: mdiHelpCircleOutline,
  },
} as const;

const badge = computed(() => BADGES[state]);
</script>

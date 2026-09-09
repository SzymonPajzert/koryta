<template>
  <client-only>
    <div class="d-inline-flex align-center ga-1" data-testid="verdict-buttons">
      <v-btn
        icon
        size="small"
        color="error"
        :variant="correct < 0 ? 'tonal' : 'text'"
        aria-label="Niepoprawny fakt"
        @click.stop.prevent="emit('choose', 'incorrect')"
      >
        <v-icon size="22">{{ mdiCloseCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top">
          Niepoprawny fakt
        </v-tooltip>
      </v-btn>

      <v-btn
        icon
        size="small"
        color="warning"
        :variant="insufficient > 0 ? 'tonal' : 'text'"
        aria-label="Za mało informacji"
        @click.stop.prevent="emit('choose', 'insufficient')"
      >
        <v-icon size="22">{{ mdiHelpCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top">
          Za mało informacji
        </v-tooltip>
      </v-btn>

      <v-btn
        icon
        size="small"
        color="success"
        :variant="correct > 0 ? 'tonal' : 'text'"
        aria-label="Poprawny fakt"
        @click.stop.prevent="emit('choose', 'correct')"
      >
        <v-icon size="22">{{ mdiCheckCircleOutline }}</v-icon>
        <v-tooltip activator="parent" location="top">Poprawny fakt</v-tooltip>
      </v-btn>
    </div>
  </client-only>
</template>

<script setup lang="ts">
import {
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { ClientOnly } from "#components";
import type { FactVerdict } from "~/utils/extraction";

/** The three buttons a fact is judged with, and nothing else.
 *
 * The row is drawn in two places that agree on what it should look like and
 * disagree entirely on what a click costs: `ExtractionVoteButtons` reads and
 * writes a live vote document, `ExtractionQuickVerdict` writes once and
 * subscribes to nothing. Keeping the markup in one place is what stops the
 * review queue and a person's page drifting into two different sets of
 * verdicts.
 *
 * `stop.prevent` on every click: the card underneath is a link on one surface
 * and swipeable on another, and a verdict is neither of those. */
const { correct = 0, insufficient = 0 } = defineProps<{
  /** Where the reader stands on the fact itself: above zero „poprawny", below
   * it „niepoprawny", zero neither. One number rather than two flags, because
   * the two are ends of one axis and share a vote category. */
  correct?: number;
  /** „Za mało informacji" - its own axis, since a reviewer who cannot decide
   * has not thereby said the fact is wrong. */
  insufficient?: number;
}>();

const emit = defineEmits<{ choose: [verdict: FactVerdict] }>();
</script>

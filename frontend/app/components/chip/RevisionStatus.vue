<template>
  <span class="d-inline-flex align-center ga-1 flex-wrap">
    <v-chip
      :color="tone.color"
      :size="size"
      :prepend-icon="icon"
      variant="tonal"
      data-testid="revision-status"
    >
      {{ tone.label }}
      <v-tooltip
        activator="parent"
        location="bottom"
        max-width="280"
        open-on-click
      >
        {{ proposalStatusHints[status] }}
      </v-tooltip>
    </v-chip>

    <v-chip
      v-if="derived"
      size="x-small"
      variant="text"
      class="px-1 text-medium-emphasis"
      :prepend-icon="mdiHelpCircleOutline"
      :aria-label="derivedHint"
      data-testid="revision-status-derived"
    >
      odczytany
      <v-tooltip
        activator="parent"
        location="bottom"
        max-width="280"
        open-on-click
      >
        {{ derivedHint }}
      </v-tooltip>
    </v-chip>
  </span>
</template>

<script setup lang="ts">
/** Where one proposal stands, in the same four words everywhere it is shown.
 *
 * The reviewer's queue and the author's own list render this component rather
 * than each choosing a label, because a contributor told `Zatwierdzona` while
 * the reviewer reads `Zastąpiona` has been misled by a rendering difference.
 */
import { mdiHelpCircleOutline } from "@mdi/js";
import { computed } from "vue";
import { revisionStatusIcons } from "~/utils/revisionStatus";
import {
  proposalStatusHints,
  proposalStatusLabels,
  type ProposalStatus,
} from "~~/shared/proposals";

const props = withDefaults(
  defineProps<{
    status: ProposalStatus;
    /** The status was worked out from the entry, not read off the revision. */
    derived?: boolean;
    size?: string;
  }>(),
  { derived: false, size: "small" },
);

const tone = computed(() => proposalStatusLabels[props.status]);
const icon = computed(() => revisionStatusIcons[props.status]);

/** A status nobody recorded is a reading of the data, and a reviewer deciding
 * on it should know which of the two they have. The marker itself is visible
 * text and both tooltips open on tap as well as hover, so the explanation is
 * not stranded on a device without a pointer. */
const derivedHint =
  "Status odczytany z wpisu (rewizja sprzed wprowadzenia recenzji).";
</script>

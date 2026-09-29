<template>
  <div class="d-flex flex-wrap align-center ga-1">
    <v-btn
      color="ink-success"
      variant="tonal"
      size="small"
      :prepend-icon="mdiCheck"
      :loading="loading"
      :disabled="!proposal.targetExists"
      :data-testid="`approve-${proposal.id}`"
      @click="emit('approve', { publish: false })"
    >
      Zatwierdź
    </v-btn>
    <!-- Why the button above is greyed out. Not a tooltip on the button
         itself: Vuetify gives a disabled v-btn `pointer-events: none`, so a
         tooltip anchored to it can never open, by mouse or by keyboard. -->
    <span
      v-if="!proposal.targetExists"
      class="text-caption text-medium-emphasis"
    >
      Wpis już nie istnieje
    </span>

    <!-- Not on a removal: there is no page left to publish, and the server
         ignores the request for one. Offered anyway, it was the prominent
         button, and it read as "delete and put live". -->
    <v-btn
      v-if="
        !proposal.published &&
        proposal.targetExists &&
        proposal.kind !== 'removal'
      "
      color="ink-success"
      variant="flat"
      size="small"
      :prepend-icon="mdiEarth"
      :loading="loading"
      :data-testid="`approve-publish-${proposal.id}`"
      @click="emit('approve', { publish: true })"
    >
      Zatwierdź i opublikuj
    </v-btn>

    <v-btn
      v-if="rejectable"
      color="ink-danger"
      variant="text"
      size="small"
      :prepend-icon="mdiClose"
      :loading="loading"
      :data-testid="`reject-${proposal.id}`"
      @click="emit('reject')"
    >
      Odrzuć
    </v-btn>
  </div>
</template>

<script setup lang="ts">
/** The decisions available on one proposal, and nothing else.
 *
 * Approving and publishing are offered separately because they are separate
 * things: approving settles what the entry says, publishing settles who can
 * read it, and a reviewer who wanted only the first would otherwise have to
 * remember that. The buttons keep the `data-testid`s the comparison page used
 * when it carried its own, so a spec written against either reads the same.
 *
 * Only decisions. The row used to end in "Porównanie" and a copy-link icon as
 * well, and "Porównanie" was there for an entry's proposal but not for a
 * relation's, which has no comparison page: two kinds of button side by side,
 * one deciding here and one leaving for another page, and which of them a row
 * got depended on something the row did not show. The owner asked why there
 * were two kinds. Both are links now, on what they lead from - the comparison
 * under the diff it shows in full (`RevisionChangeCell`), the proposal's
 * address on its date (`RevisionPermalink`) - so every proposal waiting for a
 * decision ends in the same buttons, and a settled one in none.
 *
 * The colours are ink tokens: Vuetify's `success` as the text of a tonal
 * button is 2.5:1, and white on it as a filled one 2.8:1.
 */
import { mdiCheck, mdiClose, mdiEarth } from "@mdi/js";
import type { Proposal } from "~~/shared/proposals";

withDefaults(
  defineProps<{
    proposal: Proposal;
    /** Whether "Odrzuć" is among the decisions. An entry's history lets a
     * reviewer approve an older version back - the only way to undo a bad
     * approval - and rejecting something that was once approved, or already
     * rejected, would only overwrite the record of it. */
    rejectable?: boolean;
    loading?: boolean;
  }>(),
  { rejectable: true, loading: false },
);

const emit = defineEmits<{
  approve: [options: { publish: boolean }];
  reject: [];
}>();
</script>

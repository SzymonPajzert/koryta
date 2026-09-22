<template>
  <div class="d-flex flex-wrap align-center ga-1">
    <template v-if="reviewable">
      <v-btn
        color="success"
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
        color="success"
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
        color="error"
        variant="text"
        size="small"
        :prepend-icon="mdiClose"
        :loading="loading"
        :data-testid="`reject-${proposal.id}`"
        @click="emit('reject')"
      >
        Odrzuć
      </v-btn>
    </template>

    <v-btn
      v-if="fullComparisonTo"
      variant="text"
      size="small"
      :prepend-icon="mdiCompare"
      :to="fullComparisonTo"
    >
      Porównanie
    </v-btn>

    <v-btn
      icon
      variant="text"
      size="x-small"
      :data-testid="`permalink-${proposal.id}`"
      aria-label="Skopiuj link do tej propozycji"
      @click="emit('permalink')"
    >
      <v-icon :icon="mdiLinkVariant" size="small" />
      <v-tooltip activator="parent" location="bottom">
        Skopiuj link do tej propozycji
      </v-tooltip>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
/** The decisions available on one proposal, in one place.
 *
 * Approving and publishing are offered separately because they are separate
 * things: approving settles what the entry says, publishing settles who can
 * read it, and a reviewer who wanted only the first would otherwise have to
 * remember that. The buttons keep the `data-testid`s the existing comparison
 * page uses, so a spec written against either reads the same.
 */
import {
  mdiCheck,
  mdiClose,
  mdiCompare,
  mdiEarth,
  mdiLinkVariant,
} from "@mdi/js";
import type { Proposal } from "~~/shared/proposals";

defineProps<{
  proposal: Proposal;
  /** Whether a decision is still open on this one. A settled proposal keeps its
   * row - the permalink has to resolve after the fact - but not its buttons. */
  reviewable: boolean;
  loading?: boolean;
  fullComparisonTo?: string | null;
}>();

const emit = defineEmits<{
  approve: [options: { publish: boolean }];
  reject: [];
  permalink: [];
}>();
</script>

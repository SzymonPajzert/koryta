<template>
  <v-chip
    v-if="visible"
    size="x-small"
    variant="flat"
    class="bg-surface-warning font-weight-medium"
    :data-testid="`place-clash-chip-${edge.id ?? 'unknown'}`"
  >
    dwa miejsca
    <v-tooltip activator="parent" location="bottom" max-width="300">
      Inne miejsce w tych samych wyborach ({{ election }}): {{ elsewhere }}. W
      jednych wyborach kandyduje się w jednym miejscu, więc jedna z tych
      kandydatur należy najpewniej do imiennika.
    </v-tooltip>
  </v-chip>
</template>

<script setup lang="ts">
/** Marks a candidacy that puts the person in two places in one election.
 *
 * Next to `ChipEdgeDraftStatus`, because its „Opublikuj" is one of the two ways
 * a namesake's run goes live - the publish dialog, which says the same thing in
 * its own words, is the other. On a published row it marks what
 * `test_nobody_stands_in_two_places_at_once` counts every night, so whoever is
 * on the page can see which of the two to take down.
 *
 * For signed in readers only, like the draft badge: a logged out visitor sees
 * published candidacies alone, and a guess about a namesake is not something
 * to print on a public profile.
 */
import { computed } from "vue";
import { useAuthState } from "~/composables/auth";
import type { EdgeNode } from "~/composables/edges";
import {
  clashElection,
  placesAgree,
  regionTeryt,
  type PlaceClash,
} from "~~/shared/twoPlaces";

const props = defineProps<{
  /** The row. */
  edge: EdgeNode;
  /** The clash it takes part in, or nothing, which draws nothing. */
  clash?: PlaceClash<EdgeNode>;
}>();

const { user } = useAuthState();

const visible = computed(() => !!user.value && !!props.clash);

const election = computed(() =>
  props.clash ? clashElection(props.clash, ", ") : "",
);

/** The other places, each once - not the rows that agree with this one, which
 * a clash also holds when a third place disagrees with both. */
const elsewhere = computed(() => {
  const here = regionTeryt(props.edge.target);
  const names = new Set<string>();
  for (const row of props.clash?.rows ?? []) {
    const there = regionTeryt(row.target);
    if (!here || !there || placesAgree(here, there)) continue;
    names.add(row.richNode.name || row.target);
  }
  return Array.from(names).join(", ");
});
</script>

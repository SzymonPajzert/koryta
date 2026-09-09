<template>
  <ExtractionVerdictButtons
    :correct="correctVote"
    :insufficient="insufficientVote"
    @choose="choose"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useVotes } from "~/composables/votes";
import { ExtractionVerdictButtons } from "#components";
import type { FactVerdict } from "~/utils/extraction";

const { id } = defineProps<{
  id: string;
}>();

// Both categories live in the same vote document; two subscriptions to the
// same doc are cheap (vuefire shares the underlying listener). Only mount this
// where a handful of cards are on screen at once - `ExtractionQuickVerdict` is
// the same row with no subscription at all, for the surfaces that are not.
const correct = useVotes(id, "correct", "extraction");
const insufficient = useVotes(id, "insufficient", "extraction");

const correctVote = computed(
  () => correct.userCategoryVotes.value.correct || 0,
);
const insufficientVote = computed(
  () => insufficient.userCategoryVotes.value.insufficient || 0,
);

function choose(verdict: FactVerdict) {
  if (verdict === "insufficient") {
    setInsufficient(insufficientVote.value > 0 ? 0 : 1);
    return;
  }
  const target = verdict === "correct" ? 1 : -1;
  setCorrect(correctVote.value === target ? 0 : target);
}

// castVote applies a delta, so aim it at the target value.
function setCorrect(target: number) {
  correct.castVote(target - correctVote.value);
}

function setInsufficient(target: number) {
  insufficient.castVote(target - insufficientVote.value);
}
</script>

<template>
  <ExtractionVerdictButtons
    :correct="correctVote"
    :insufficient="insufficientVote"
    @choose="choose"
  />

  <!-- Outside the row, like the one in `badge/PersonSection.vue` and for the
       same reason: the failure has to outlive the control that caused it. The
       row is three icon buttons with no room for a sentence, and it is drawn
       inside a group that is collapsed by default (`ExtractionArticleGroup`)
       and unmounts its cards when it closes - a message written onto the button
       would go with them. -->
  <v-snackbar v-model="errorShown" color="error" :timeout="6000">
    {{ error }}
  </v-snackbar>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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

const error = ref("");
const errorShown = ref(false);

/** File this reader's verdict on the fact, and say so when Firestore refuses.
 *
 * The `await` is the change here, and it is not tidying. `castVote`
 * (app/composables/votes.ts) used to call `setDoc` and drop the promise, so
 * every call site was fire-and-forget by construction and a rejected write was
 * a click that changed nothing and reported nothing. It now awaits the write
 * and propagates whatever Firestore threw - deliberately, because the rules
 * over `votes/${id}_${uid}` were tightened in the same change (a cap on how
 * many keys one `categoryVotes` may carry, `MAX_VOTE_KEYS` in
 * shared/badges.ts), and a silent PERMISSION_DENIED is the one failure nobody
 * could diagnose from a bug report.
 *
 * `button/vote/Number.vue` already awaited it and `badge/PersonSection.vue`
 * catches it; this was the only path the new rejection had nowhere to go. The
 * two helpers below were called without `await`, and a promise dropped inside a
 * synchronous handler rejects on the window rather than through Vue - so it
 * reached neither `app.config.errorHandler`, where the async handler in
 * `Number.vue` sends its own, nor anything the reader could see.
 *
 * Caught here rather than left to that handler, now that awaiting would reach
 * it: what is on the other end is `@sentry/nuxt` (nuxt.config.ts), which files
 * the error and shows the reader nothing. The row would go on displaying their
 * click as though it had landed, which is the half of the problem a bug report
 * cannot fix by itself.
 */
async function choose(verdict: FactVerdict) {
  try {
    if (verdict === "insufficient") {
      await setInsufficient(insufficientVote.value > 0 ? 0 : 1);
      return;
    }
    const target = verdict === "correct" ? 1 : -1;
    await setCorrect(correctVote.value === target ? 0 : target);
  } catch (err) {
    // The reader gets the Polish sentence and the console gets the original:
    // what Firestore throws here is „Missing or insufficient permissions.”, an
    // English rules message that names neither the fact nor the category, and
    // it is worth more in a bug report than in a snackbar. Same split as
    // `extraction/AddToNoteButton.vue`.
    console.error("Nie udało się zapisać oceny faktu", id, err);
    error.value = "Nie udało się zapisać oceny. Spróbuj ponownie.";
    errorShown.value = true;
  }
}

// castVote applies a delta, so aim it at the target value.
async function setCorrect(target: number) {
  await correct.castVote(target - correctVote.value);
}

async function setInsufficient(target: number) {
  await insufficient.castVote(target - insufficientVote.value);
}
</script>

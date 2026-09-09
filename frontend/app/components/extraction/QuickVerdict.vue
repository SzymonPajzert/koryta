<template>
  <ExtractionVerdictButtons
    :correct="shownCorrect"
    :insufficient="shownInsufficient"
    @choose="choose"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { castVoteOnce } from "~/composables/votes";
import { useCurrentUser } from "vuefire";
import { ExtractionVerdictButtons } from "#components";
import type { FactVerdict } from "~/utils/extraction";
import type { NodeStats } from "~~/shared/model";

/** Judging a fact where it is shown, at the cost of one write.
 *
 * `ExtractionVoteButtons` is the same row backed by `useVotes`, which opens a
 * vuefire subscription per card. That is affordable behind an expander, where
 * a handful of cards are mounted at a time; a person's page mounts every fact
 * they have at once, and far more readers get there than ever open the review
 * queue. */
const { id, votes = {} } = defineProps<{
  /** The extraction being judged. */
  id: string;
  /** The fact's own vote aggregate, as it arrived with the document. Reading
   * it costs nothing, and it is the only thing here that knows whether anybody
   * has looked at this fact before. */
  votes?: NodeStats["votes"];
}>();

const user = useCurrentUser();
const router = useRouter();
const route = useRoute();

/** This reader's clicks, `undefined` until they make one.
 *
 * Falling back to the aggregate is an approximation and knows it: the
 * aggregate sums everybody's verdicts and never names them, so it cannot say
 * whether *this* reader voted - and asking would cost the per-card listener
 * this component exists to avoid. What it buys is that a fact somebody has
 * already judged reads as judged, which is the half of the truth a reader
 * needs; a click still writes their own verdict over it. */
const ownCorrect = ref<number | undefined>(undefined);
const ownInsufficient = ref<number | undefined>(undefined);

const shownCorrect = computed(() => ownCorrect.value ?? numeric(votes.correct));
const shownInsufficient = computed(
  () => ownInsufficient.value ?? numeric(votes.insufficient),
);

async function choose(verdict: FactVerdict) {
  if (!user.value) {
    router.push({ path: "/login", query: { redirect: route.fullPath } });
    return;
  }

  if (verdict === "insufficient") {
    const next = shownInsufficient.value > 0 ? 0 : 1;
    ownInsufficient.value = next;
    // Moving a verdict between the two axes has to take the old one back by
    // hand: `castVoteOnce` merges one category into the single vote document
    // this reader has on the fact, so „za mało informacji" after „poprawny"
    // would otherwise leave the fact counted as both.
    if (next > 0 && shownCorrect.value !== 0) {
      ownCorrect.value = 0;
      await castVoteOnce(id, "correct", 0, "extraction");
    }
    await castVoteOnce(id, "insufficient", next, "extraction");
    return;
  }

  const target = verdict === "correct" ? 1 : -1;
  // On the sign rather than the value: what is shown may be several readers'
  // verdicts summed, and clicking a lit button has to switch it off rather
  // than write a 1 under a 2 and look like it did nothing.
  const next = Math.sign(shownCorrect.value) === target ? 0 : target;
  ownCorrect.value = next;
  if (next !== 0 && shownInsufficient.value > 0) {
    ownInsufficient.value = 0;
    await castVoteOnce(id, "insufficient", 0, "extraction");
  }
  // 0 rather than a delete, for the same reason: that one document also holds
  // this reader's „To nie ta osoba" flag.
  await castVoteOnce(id, "correct", next, "extraction");
}

/** A vote category is only written once somebody has voted in it, so every
 * read of the aggregate has to survive the field being absent. */
function numeric(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
</script>

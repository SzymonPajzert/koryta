<template>
  <section
    class="clist"
    data-testid="chain-candidates"
    :data-direction="direction"
  >
    <div class="sec-head">
      <h3 class="text-subtitle-2 font-weight-bold">{{ heading }}</h3>
      <v-chip v-if="candidates.length" size="x-small" variant="tonal">
        {{ polishCounting(candidates.length, "osoba", "osoby", "osób") }}
      </v-chip>
    </div>

    <!-- Once per list, not once per card. Every candidate in a batch carries
         the same `batchSize`, so a note on each of Ryszard Grobelny's six
         Związek Miast Polskich predecessors would say the same sentence six
         times - and the sentence is about the list, not about any one of the
         people in it. -->
    <p v-if="batched" class="k-lead clist__note" data-testid="chain-batch-note">
      {{ batchNote }}
    </p>

    <!-- The commonest ending in the register: 11,360 of 18,279 spells have no
         neighbour at all within the window. Said out loud, because a heading
         over empty space reads as a page that failed to load. -->
    <p v-if="!candidates.length" class="k-note clist__empty">
      Nikogo tu nie znaleźliśmy.
    </p>

    <SuccessionChainCandidate
      v-for="view in shown"
      :key="view.candidate.personId"
      :view
      :node-key="nodeKey"
      :direction
      @expand="emit('expand', $event)"
      @collapse="emit('collapse', $event)"
    />

    <v-btn
      v-if="candidates.length > VISIBLE"
      class="text-none clist__more"
      data-testid="chain-more"
      density="comfortable"
      size="small"
      variant="text"
      @click="showAll = !showAll"
    >
      {{ showAll ? "Pokaż mniej" : `Pokaż wszystkich (${candidates.length})` }}
    </v-btn>
  </section>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { polishCounting } from "~/composables/polish";
import type {
  ChainCandidateView,
  ChainDirection,
  ExpandPayload,
} from "~/composables/successionChain";

const props = defineProps<{
  candidates: ChainCandidateView[];
  direction: ChainDirection;
  /** The node these candidates hang off, passed straight through to the cards
   * so that an `expand` says which node it grows from. */
  nodeKey: string;
  /** How far from the focus person the people in THIS list stand, i.e. the
   * owning node's depth plus one. The heading is a step count past the first
   * hop, because „Kto mógł być wcześniej” stops being true once the list is
   * hanging off somebody who is not the person the page is about. */
  depth: number;
}>();

const emit = defineEmits<{
  (e: "expand", payload: ExpandPayload): void;
  (e: "collapse", nodeKey: string): void;
}>();

/** How many cards a list shows before it asks.
 *
 * A courtesy and not paging: the measured fan-out is a median of 2 candidates
 * per person, 7 at the ninetieth percentile, 13 at the ninety-ninth and 30 at
 * the worst person in the register - so this button is on screen for roughly
 * one list in a hundred and there is nothing to fetch behind it. The endpoint
 * caps nothing, deliberately: a cap there would be the page quietly deciding
 * that the thirteenth candidate is not a candidate.
 */
const VISIBLE = 12;

const showAll = ref(false);

const shown = computed(() =>
  showAll.value ? props.candidates : props.candidates.slice(0, VISIBLE),
);

const heading = computed(() => {
  if (props.direction === "predecessor") {
    return props.depth > 1
      ? `Krok ${props.depth} wstecz`
      : "Kto mógł być wcześniej";
  }
  return props.depth > 1
    ? `Krok ${props.depth} naprzód`
    : "Kto mógł być później";
});

/** Whether the register filed a batch rather than a handover anywhere in this
 * list. `batchSize` is counted per seat and per day, so one candidate reached
 * through a batch is enough to make the whole list a set of equally good
 * answers - which is the thing this page exists to be honest about. */
const batched = computed(() =>
  props.candidates.some((view) =>
    view.candidate.via.some((entry) => entry.batchSize > 1),
  ),
);

/** The same fact from the reader's side of it. Split in two rather than
 * written impersonally, because „po kim ta osoba objęła stanowisko” and „kto
 * objął stanowisko po tej osobie” are the two questions the columns answer and
 * a single sentence covering both would answer neither. */
const batchNote = computed(() =>
  props.direction === "predecessor"
    ? "Tego samego dnia zmieniło się w tym organie kilka miejsc naraz. Rejestr nie zapisuje, po kim konkretnie ta osoba objęła stanowisko - każda z wypisanych osób pasuje tak samo."
    : "Tego samego dnia zmieniło się w tym organie kilka miejsc naraz. Rejestr nie zapisuje, kto konkretnie objął stanowisko po tej osobie - każda z wypisanych osób pasuje tak samo.",
);
</script>

<style scoped>
/* `sec-head`, `k-lead` and `k-note` are global (app.vue) and are not restated
   here; what follows is only this list's own spacing. */

.clist {
  min-width: 0;
}

.clist + .clist {
  margin-top: 14px;
}

.clist__note {
  /* `k-lead` caps itself at 78ch for a paragraph running the width of a page.
     Inside a 260px column that cap never bites, and the margin it carries for
     a section lead is too much air above a list of cards. */
  margin: 2px 0 6px;
}

.clist__empty {
  font-size: 0.75rem;
  line-height: 1.4;
  margin-top: 4px;
  padding: 8px 10px;
}

.clist__more {
  margin-left: -8px;
  margin-top: 2px;
}
</style>

<template>
  <article
    class="k-card k-card--accent cand"
    data-testid="chain-candidate"
    :data-person="candidate.personId"
    :data-direction="direction"
  >
    <div class="cand__head">
      <NuxtLink :to="personUrl" class="link-plain cand__name">
        {{ candidate.personName }}
      </NuxtLink>
      <PartyChip v-for="party in candidate.parties" :key="party" :party />
      <!-- Named anyway: the page is behind the login gate, and most people in
           the register have no published page (1,093 of 9,301 did on
           2026-09-10), so hiding every unpublished candidate would empty the
           chain rather than protect anybody. The chip is what keeps a reader
           from taking a draft for a page they can send somebody. -->
      <span
        v-if="!candidate.published"
        class="cand__draft"
        data-testid="chain-candidate-draft"
        title="Strona tej osoby nie jest jeszcze opublikowana."
      >
        szkic
      </span>
    </div>

    <!-- One line per seat the candidacy rests on. Almost always one, but two
         people can sit next to each other in two companies at once and the
         endpoint merges them into a single card on purpose - so the card has
         to be able to say "and also here", or a reader looking at Ryszard
         Grobelny's successor would have no way of telling which of his six
         posts the claim comes from. -->
    <div
      v-for="entry in candidate.via"
      :key="`${entry.focusEdgeId}|${entry.edgeId}`"
      class="cand__via"
    >
      <div class="cand__where">{{ entry.companyName }} · {{ entry.role }}</div>
      <div class="cand__when">{{ whenLine(entry) }}</div>
    </div>

    <div class="cand__foot">
      <!-- Two buttons rather than one with a computed label, so that the
           testid a test reaches for names what the button does. The same
           candidate card is both, one click apart. -->
      <v-btn
        v-if="expandable && view.expandedKey === null"
        class="text-none"
        data-testid="chain-expand"
        density="comfortable"
        :prepend-icon="
          direction === 'predecessor'
            ? mdiChevronDoubleLeft
            : mdiChevronDoubleRight
        "
        size="small"
        variant="text"
        @click="
          emit('expand', {
            nodeKey,
            direction,
            personId: candidate.personId,
          })
        "
      >
        Rozwiń
      </v-btn>

      <v-btn
        v-else-if="expandable"
        class="text-none"
        data-testid="chain-collapse"
        density="comfortable"
        :prepend-icon="mdiUnfoldLessHorizontal"
        size="small"
        variant="text"
        @click="emit('collapse', view.expandedKey!)"
      >
        Zwiń
      </v-btn>

      <!-- Printed rather than dropped: the register saying a seat came back to
           somebody already in this chain is a fact worth seeing. What it must
           not have is a button, because following it grows A → B → A for
           ever - which is why the composable refuses the expansion too, and
           not only the card. -->
      <span
        v-else
        class="cand__cycle"
        data-testid="chain-candidate-cycle"
        title="Ta osoba jest już wyżej w tym łańcuchu - rejestr mówi, że stanowisko do niej wróciło."
      >
        już w łańcuchu
      </span>
    </div>
  </article>
</template>

<script lang="ts" setup>
import {
  mdiChevronDoubleLeft,
  mdiChevronDoubleRight,
  mdiUnfoldLessHorizontal,
} from "@mdi/js";
import { computed } from "vue";
import { generateEntityUrl } from "~/composables/slugs";
import type {
  ChainCandidateView,
  ChainDirection,
  ExpandPayload,
} from "~/composables/successionChain";
import type { SuccessionVia } from "~~/server/api/edges/succession-chain.get";
import { gapLabel } from "~~/shared/succession";
import { shortDate } from "~~/shared/dates";

const props = defineProps<{
  /** The candidate and what the chain currently knows about them: whether they
   * have been opened, and whether they may be. */
  view: ChainCandidateView;
  /** The node this card sits in. Travels with the payload rather than being
   * derived from anything here, because one person can appear as a candidate
   * under several nodes at once and only the caller knows which of them was
   * clicked. */
  nodeKey: string;
  direction: ChainDirection;
}>();

const emit = defineEmits<{
  (e: "expand", payload: ExpandPayload): void;
  (e: "collapse", nodeKey: string): void;
}>();

const candidate = computed(() => props.view.candidate);

const expandable = computed(() => props.view.expandable);

const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    candidate.value.personId,
    candidate.value.personName,
  ),
);

/** When this person held the seat, and how far their filing is from the focus
 * person's.
 *
 * `gapLabel` and `shortDate` from the shared modules rather than a formatter
 * of this component's own: „tego samego dnia” is the sentence the person page
 * and the company page already use for a gap of zero, and the score behind
 * them counts the same days. A second Intl formatter here would also print a
 * register day in the browser's zone, which west of Greenwich is the day
 * before (see `shared/dates.ts`).
 */
function whenLine(entry: SuccessionVia): string {
  const end = entry.end ? shortDate(entry.end) : "nadal";
  return `${gapLabel(entry.gapDays)} · ${shortDate(entry.start)} – ${end}`;
}
</script>

<style scoped>
/* `k-card`, `k-card--accent` and `link-plain` are global (app.vue). Five
   components hand-copied them once and all five drifted; what is left here is
   this card's own idiom. */

.cand {
  padding: 8px 10px 8px 12px;
}

.cand + .cand {
  margin-top: 6px;
}

.cand__head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cand__name {
  color: rgba(var(--v-theme-on-surface), 0.87);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.35;
}

/* A word, not a warning: an unpublished page is the normal state of a person
   in this register, so a coloured pill round it would paint most of the
   screen. */
.cand__draft {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.625rem;
  letter-spacing: 0.04em;
  line-height: 1.6;
  padding: 0 5px;
  text-transform: uppercase;
}

.cand__via {
  margin-top: 4px;
}

.cand__where {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.75rem;
  line-height: 1.35;
}

.cand__when {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.cand__foot {
  margin-top: 4px;
  /* The button's own padding would otherwise indent it past the text above
     it; -8px puts its label back on the card's left edge. */
  margin-left: -8px;
}

.cand__cycle {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.6875rem;
  line-height: 1.4;
  /* Cancels the negative margin the foot uses to pull a v-btn's padding back,
     which this span does not have. */
  margin-left: 8px;
}
</style>

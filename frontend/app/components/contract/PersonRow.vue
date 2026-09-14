<template>
  <div
    class="k-card pa-3 mb-2 person-row"
    :class="{ 'person-row--draft': isDraft }"
    data-testid="umowy-osoba"
  >
    <div class="person-row__who">
      <NuxtLink
        :to="generateEntityUrl('person', row.person.id, row.person.name)"
        class="link-plain font-weight-medium"
      >
        {{ row.person.name }}
      </NuxtLink>
      <PartyChip
        v-for="party in row.person.parties"
        :key="party"
        :party="party"
      />
      <!-- Reused byte for byte: it already renders only for a signed in reader
           (`visible = !!user && published !== true`), already carries the word
           „szkic" in the measured 5.54:1 warning pair, and already offers an
           admin the inline „Opublikuj". A second badge saying the same thing in
           another colour is how the three that already existed drifted apart. -->
      <ChipDraftStatus
        v-if="pageIsDraft"
        :published="false"
        :node-id="row.person.id"
        :node-name="row.person.name"
      />
      <!-- The other half of „nasza opinia": the page is live, the seat is not.
           252 employment edges graph wide are that shape, and calling them
           „szkic" would say the wrong thing about a published person. -->
      <v-chip
        v-else-if="linkUnconfirmed"
        size="x-small"
        variant="outlined"
        color="ink-warning"
      >
        powiązanie niepotwierdzone
      </v-chip>
    </div>

    <div class="person-row__where text-body-2">
      <template v-if="firstSeat">
        <!-- The role as the endpoint resolved it. `displayRole` already ran
             server side, against the institution's own `supervisoryBody`, so a
             hospital's rada społeczna does not print here as Rada Nadzorcza -
             and it cannot run again in the browser, which has no company node
             to ask. -->
        <span v-if="firstSeat.role">{{ firstSeat.role }} — </span>
        <NuxtLink
          :to="generateEntityUrl('place', firstSeat.nodeId, firstSeat.name)"
          class="link-plain"
        >
          {{ firstSeat.name }}
        </NuxtLink>
      </template>
      <v-btn
        v-if="otherSeats.length"
        variant="text"
        size="x-small"
        class="ml-1"
        :aria-expanded="expanded"
        data-testid="umowy-osoba-expand"
        @click="expanded = !expanded"
      >
        {{ moreSeatsLabel }}
      </v-btn>
    </div>

    <!-- `display: contents` at desktop width, so these two become the third and
         fourth grid columns without a second template. Below that they are one
         wrapping line, which is what the phone layout asks for. -->
    <div class="person-row__facts text-caption text-ink-neutral">
      <span class="person-row__count">
        {{ polishCountingGrouped(row.contractCount, ...contractForms) }}
        <template v-if="row.lastSignedAt">
          · ostatnia {{ longDate(row.lastSignedAt) }}
        </template>
      </span>
      <span class="person-row__sum">
        {{ plnCompact(row.totalValue) }}
        <!-- Under the figure and never beside it: the sum is what flowed
             through these institutions in the window the register covers, which
             is six weeks, and without this line it reads as a career total. -->
        <span class="person-row__window d-block">w tym okresie</span>
      </span>
    </div>

    <div v-if="expanded" class="person-row__extra mt-2">
      <div v-for="seat in row.companies" :key="seat.nodeId" class="mb-3">
        <p class="text-body-2 mb-1">
          <span v-if="seat.role">{{ seat.role }} — </span>
          <NuxtLink
            :to="generateEntityUrl('place', seat.nodeId, seat.name)"
            class="link-plain"
          >
            {{ seat.name }}
          </NuxtLink>
        </p>
        <!-- The three largest of that institution's contracts, drawn by the same
             component /umowy draws: the row is where the clamp, the redaction
             wording and the money format are written, and a second rendering of
             a contract here would be a fourth place to get them wrong. -->
        <ContractFeed
          :query="{ nodeId: seat.nodeId, sort: 'kwota', limit: 3 }"
          empty-text="Nie mamy umów tej instytucji w pobranym okresie."
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** One person in the signed-in contracts queue: who they are, where they sit,
 * and how much public money went through those institutions in the window the
 * register covers.
 *
 * **The label is always „Kogo znamy po tej stronie" or „Naszym zdaniem
 * powiązani". Never „podpisał", never „odpowiada za", never „beneficjent".**
 * The graph says who sits on a board. It does not say who signed anything, and
 * every contract here was matched to an institution by NIP, not to a person by
 * anything. Wording that implies otherwise turns an unreviewed join into an
 * accusation, on the one surface where editors decide what to publish.
 *
 * No sage rail (`k-card--accent`): that marks a card carrying a claim on a
 * page, and this is a row in a work queue. What it does carry, when the person
 * or the seat is still a draft, is `person-row--draft` - scoped to this
 * component rather than added to `app.vue`, which says in as many words that a
 * component needing something else says so in a class of its own.
 */
import { computed, ref } from "vue";
import { generateEntityUrl } from "~/composables/slugs";
import { polishCounting, polishCountingGrouped } from "~/composables/polish";
import { longDate } from "~~/shared/dates";
import { plnCompact } from "~~/shared/money";
import { contractForms, type ContractPersonRow } from "~~/shared/contracts";

const props = defineProps<{ row: ContractPersonRow }>();

const expanded = ref(false);

/** Anything on this row that is our opinion rather than the record: the
 * person's page, or any one of the seats that put them here. */
const isDraft = computed(
  () => props.row.person.ours || props.row.companies.some((c) => c.ours),
);

/** Whether the person's own page is the draft, as far as the wire can say.
 *
 * The response carries one `ours` per (person, institution) pair and no flag of
 * its own for the node, so „every seat is unpublished" is the closest this row
 * gets to „the page is unpublished". It is exact in the common case - a draft
 * person has no published seat by construction - and over-reports for the rare
 * published person all of whose employments are still drafts. `ChipDraftStatus`
 * links to the page itself, which settles it in one click. If that rare case
 * starts mattering, the fix is a `personPublished` boolean on `ContractPerson`,
 * not a cleverer guess here.
 */
const pageIsDraft = computed(
  () =>
    props.row.companies.length > 0 && props.row.companies.every((c) => c.ours),
);

const linkUnconfirmed = computed(
  () => !pageIsDraft.value && props.row.companies.some((c) => c.ours),
);

const firstSeat = computed(() => props.row.companies[0]);
const otherSeats = computed(() => props.row.companies.slice(1));

const moreSeatsLabel = computed(() =>
  expanded.value
    ? "Zwiń"
    : `+${polishCounting(otherSeats.value.length, "instytucja", "instytucje", "instytucji")}`,
);
</script>

<style scoped>
/* Three signals and never one: a dashed container, the sentence in the legend
   above the list, and a badge on the row. Never colour alone, never opacity,
   never a blurred name - `extraction/PersonFacts.vue` blurs placeholder bars
   rather than real ones for the same reason.

   The values are `ink.warning` at 40% and `surface.warning` from
   shared/colors.ts, written out because a border colour cannot be a Vuetify
   utility class. */
.person-row--draft {
  border-style: dashed;
  border-color: rgba(138, 80, 8, 0.4);
  border-left: 4px solid rgb(254, 234, 209);
}

.person-row__who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  /* A person with a long name and two party chips is one unbreakable row
     otherwise, and at 375px that sets the width of the document. */
  min-width: 0;
  overflow-wrap: anywhere;
}

.person-row__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

/* The separator between the two halves of the phone line, drawn rather than
   typed so that at desktop width - where they are two columns - it disappears
   with the flex row it belongs to. */
.person-row__sum::before {
  content: "· ";
}

.person-row__window {
  /* Smaller than the caption it sits under, because it qualifies the figure
     rather than adding to it. */
  font-size: 0.6875rem;
  line-height: 1.2;
}

/* One template at every width. `useDisplay()` reports width 0 under SSR, so a
   `v-if` on it renders the phone branch into the html for everybody - the rule
   this repo repeats in six places. A media query is decided by the browser
   that is actually painting. */
@media (min-width: 960px) {
  .person-row {
    display: grid;
    grid-template-columns:
      minmax(0, 2fr) minmax(0, 2fr)
      minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px 16px;
    align-items: start;
  }

  .person-row__facts {
    /* The wrapper stops being a box and its two children become the third and
       fourth columns. Without this the grid would need a fifth column for a
       container that exists only to make the phone line wrap. */
    display: contents;
  }

  .person-row__sum::before {
    content: "";
  }

  .person-row__extra {
    grid-column: 1 / -1;
  }
}
</style>

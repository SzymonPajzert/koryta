<template>
  <div v-if="published.length || drafts.length || data.morePeople > 0">
    <!-- What the register says, and what we say, kept apart. The published
         block is people whose page *and* whose seat are both public; anything
         else is downstairs, in a dashed note, labelled as our reading. -->
    <div v-if="published.length" class="people-strip">
      <span class="text-caption text-ink-neutral"
        >Kogo znamy po tej stronie:</span
      >
      <span
        v-for="person in published"
        :key="person.id"
        class="people-strip__person"
      >
        <NuxtLink
          class="link-plain font-weight-medium"
          :to="personUrl(person)"
          >{{ person.name }}</NuxtLink
        >
        <PartyChip v-for="party in person.parties" :key="party" :party />
        <span v-if="person.role" class="text-caption text-ink-neutral">
          ({{ person.role }})
        </span>
      </span>
    </div>

    <!-- The dashed container `app.vue` reserves for „something the section says
         about itself ... so it cannot be mistaken for a record" - which is
         exactly what an unpublished seat is. Three independent signals, because
         any one of them alone fails somebody: the container, the sentence, and
         the chip. Never colour on its own, never opacity, and never a blurred
         name - `filter` is a paint instruction, and the name would still be in
         the html. -->
    <div
      v-if="drafts.length"
      class="k-note mt-2"
      data-testid="umowy-people-draft"
    >
      <span class="text-caption text-ink-neutral">
        Naszym zdaniem powiązani (jeszcze nieopublikowani):
      </span>
      <span
        v-for="person in drafts"
        :key="person.id"
        class="people-strip__person"
      >
        <NuxtLink
          class="link-plain font-weight-medium"
          :to="personUrl(person)"
          >{{ person.name }}</NuxtLink
        >
        <v-chip
          size="x-small"
          variant="flat"
          class="bg-surface-warning font-weight-medium"
        >
          szkic
        </v-chip>
        <PartyChip v-for="party in person.parties" :key="party" :party />
        <span v-if="person.role" class="text-caption text-ink-neutral">
          ({{ person.role }})
        </span>
      </span>
    </div>

    <!-- A cap, not a gate, and worded so it cannot be read as one: „+4 więcej"
         leads somewhere, „po zalogowaniu" does not. Conflating the two would be
         a lie about coverage in the direction that flatters us. -->
    <div v-if="data.morePeople > 0" class="mt-1">
      <NuxtLink class="text-caption link-plain" :to="companyUrl">
        +{{ data.morePeople }} więcej
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractPartyPeople, ContractPerson } from "~~/shared/contracts";

/** Who we know sits at one end of a contract.
 *
 * The only component on this feature that names a person, so the „our opinion"
 * treatment is defined once and cannot drift across three surfaces.
 *
 * Two rules are load-bearing and neither is obvious from the markup:
 *
 * 1. **The label is always „Kogo znamy po tej stronie" or „Naszym zdaniem
 *    powiązani".** Never „podpisał", never „odpowiada za", never
 *    „beneficjent". The graph records who sits on a board; it does not record
 *    who signed anything, and a caption that says otherwise invents a fact
 *    about a named person out of a NIP match.
 * 2. **`hiddenPeople` renders nothing here.** The login prompt is the feed's
 *    job, once per list - one banner under twenty rows, not twenty banners.
 *    The count is still on the payload so the list can sum it.
 *
 * Withheld people are not in `data.people` at all: the endpoint counts them and
 * sends no name. There is nothing here to hide, which is the point - a name
 * hidden in CSS is a name in the html of an indexed page.
 */
const props = defineProps<{
  data: ContractPartyPeople;
  /** The institution these people sit in, for the „+n więcej" link's slug. The
   * link resolves without it - `parseEntityUrlSlug` reads the id off the last
   * dash segment - so it is optional. */
  companyName?: string;
}>();

const published = computed(() => props.data.people.filter((p) => !p.ours));
const drafts = computed(() => props.data.people.filter((p) => p.ours));

function personUrl(person: ContractPerson): string {
  return generateEntityUrl("person", person.id, person.name);
}

const companyUrl = computed(() =>
  generateEntityUrl("place", props.data.nodeId, props.companyName),
);
</script>

<style scoped>
.people-strip {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 0.8125rem;
  line-height: 1.5;
}

/* The name, its party chips and its role stay together when the row wraps: a
   chip that wraps away from the name it belongs to reads as the next person's.
   `min-width: 0` so a long surname can still break rather than widening the
   card - the card is 343px on a phone. */
.people-strip__person {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The draft block is a note rather than a row, so it repeats the flex context
   the published one gets from `.people-strip`. */
.k-note {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 0.8125rem;
  line-height: 1.5;
}
</style>

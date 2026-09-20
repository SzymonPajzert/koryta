<template>
  <div data-testid="queue-tiers">
    <div class="text-subtitle-2 font-weight-bold mb-1">
      Od czego zacząć: trzy poziomy trudności
    </div>
    <p class="text-body-2 text-medium-emphasis tiers__measure mb-3">
      Kolejka nie jest jednolita. Przy części osób wszystko, czego trzeba, jest
      już na stronie i robota schodzi na kwadrans; przy innych trzeba samemu
      znaleźć źródło. Wybierz poziom, a kolejka pokaże tylko takie osoby.
    </p>
    <v-row>
      <v-col v-for="card in cards" :key="card.tier" cols="12" sm="6" md="4">
        <CardAction
          :icon="card.icon"
          :title="`${card.tier}. ${card.title}`"
          :to="card.to"
          ink="ink-info"
          access="login"
          @click="task(card.tier)"
        >
          {{ card.what }}
          <div class="mt-2">{{ card.needs }}</div>
          <!-- The count is dropped rather than printed as 0 when the endpoint
               has not answered or the tier has not been computed yet: „Zostało
               0 osób” is the one number that would talk a reader out of the
               task this card exists to hand them. Same judgement as the
               progress card on the home page. -->
          <div
            v-if="card.toCheck"
            class="mt-2 font-weight-medium text-ink-info"
            :data-testid="`tier-count-${card.tier}`"
          >
            {{ polishCounting(card.toCheck, "osoba", "osoby", "osób") }} do
            sprawdzenia
          </div>
        </CardAction>
      </v-col>
    </v-row>

    <!-- What a finished one looks like, by name, because that is the question
         a first-time reader actually has: they are being asked to decide
         something about a stranger and have never seen the decision made. The
         row is dropped whole where no page has been published off the tier
         yet. -->
    <v-card
      v-if="examples.length"
      variant="outlined"
      rounded="lg"
      class="pa-4 mt-4"
    >
      <div class="text-subtitle-2 font-weight-bold mb-2">
        Tak wygląda strona, którą ktoś już sprawdził
      </div>
      <div v-for="row in examples" :key="row.tier" class="text-body-2 mb-1">
        <span class="text-medium-emphasis"
          >{{ row.tier }}. {{ row.title }}:</span
        >
        <template v-for="(person, index) in row.people" :key="person.id">
          {{ index ? ", " : " " }}
          <NuxtLink :to="person.to" class="text-ink-info">
            {{ person.name }}
          </NuxtLink>
        </template>
      </div>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
import {
  mdiBookOpenPageVariantOutline,
  mdiBallotOutline,
  mdiTextBoxSearchOutline,
} from "@mdi/js";
import {
  queueTiers,
  queueTierCopy,
  type QueueTier,
} from "~~/shared/queueTiers";
import { polishCounting } from "~/composables/polish";
import { generateEntityUrl } from "~/composables/slugs";
import { trackGoal } from "~/composables/analytics";
import { useQueueTiers } from "~/composables/stats/useQueueTiers";

/** The three difficulty tiers of the checking queue, with how many people are
 * left in each and who has already been done off it.
 *
 * The queue at /eksploruj/nowe ranks 9,074 unpublished people by how worth
 * looking at they are, and says nothing about what looking at one would take.
 * These cards answer the other question - and each links into the same queue
 * with `tier` set, so picking one here is picking what the reader will be
 * shown there.
 */

const { tiers } = useQueueTiers();

/** Which tier a reader picked, in `from` rather than as a fourth prop: the
 * goal declares `task` and `from`, and what is new here is not a new kind of
 * task - it is the same queue, entered by a door that says what it costs. */
const task = (tier: QueueTier) =>
  trackGoal("cta:task", { task: "kolejka", from: `pomoc-poziom-${tier}` });

const icons: Record<QueueTier, string> = {
  1: mdiBookOpenPageVariantOutline,
  2: mdiBallotOutline,
  3: mdiTextBoxSearchOutline,
};

const byTier = computed(
  () => new Map(tiers.value.map((row) => [row.tier, row])),
);

const cards = computed(() =>
  queueTiers.map((tier) => ({
    tier,
    ...queueTierCopy[tier],
    icon: icons[tier],
    toCheck: byTier.value.get(tier)?.toCheck ?? null,
    to: `/eksploruj/nowe?tier=${tier}`,
  })),
);

const examples = computed(() =>
  queueTiers
    .map((tier) => ({
      tier,
      title: queueTierCopy[tier].title,
      people: (byTier.value.get(tier)?.examples ?? []).map((person) => ({
        ...person,
        to: generateEntityUrl("person", person.id, person.name),
      })),
    }))
    .filter((row) => row.people.length > 0),
);
</script>

<style scoped>
/* The same measure the rest of /pomoc holds its prose to. Repeated rather than
   inherited: `pomoc__measure` is declared in that page's `<style scoped>`, so
   it stops at the page's own markup and would have been inert here. */
.tiers__measure {
  max-width: 78ch;
}
</style>

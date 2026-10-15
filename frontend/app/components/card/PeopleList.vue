<template>
  <HomeRegionsTop
    v-if="!props.region"
    ref="regionsTop"
    @pick="emit('pick', $event)"
  />
  <v-card v-else border class="pt-2 mt-2 mx-auto" max-width="400">
    <!-- Focused when a region is picked, so a keyboard reader who chose a row
         of the list lands on what it opened rather than on the page's top. -->
    <v-card-title
      ref="title"
      tabindex="-1"
      class="people-list__title d-flex align-start ga-2"
    >
      <span class="flex-grow-1">{{ props.region.name }}</span>
      <!-- Back to the list of powiaty, which is otherwise gone for the rest
           of the visit once anything is picked. -->
      <v-btn
        :icon="mdiClose"
        variant="text"
        size="small"
        class="people-list__close"
        aria-label="Wróć do listy powiatów"
        title="Wróć do listy powiatów"
        data-testid="home-region-reset"
        @click="reset"
      />
    </v-card-title>
    <v-divider />

    <!-- The rows' own outline while they load, holding the card's height:
         a bare spinner collapsed it, and the click that picked a region left
         the pointer over „Zobacz cały region”. -->
    <v-skeleton-loader v-if="loading" type="list-item-two-line@4" />
    <v-card-text v-else-if="people.length === 0">
      Nie znaleźliśmy jeszcze osób w tym regionie.
    </v-card-text>
    <template v-for="person in people" v-else :key="person.name">
      <v-list-item
        height="64"
        link
        :title="person.name"
        :subtitle="subtitle(person)"
        :to="generateEntityUrl('person', person.id!, person.name)"
      >
        <template #append>
          <!-- A flex row, not a plain div: inline layout stood the chevron on
               the chip's text baseline, five pixels under the one in the rows
               without a party, so the column of arrows down the card was not
               a column. The chips sit in a wrapping box of their own, capped
               in width: three of them on one line - PSL, Polska 2050, SLD is
               a real person in Warszawa - are wider than the name's column
               can give up on a 320px phone, and the arrow was what went off
               the card. Wrapped they stack two lines inside the 64px row and
               the arrow stays where every other row has it. -->
          <div class="d-flex align-center ga-1">
            <div
              v-if="person.parties?.length"
              class="d-flex flex-wrap justify-end ga-1 party-chips"
            >
              <party-chip
                v-for="party in person.parties"
                :key="party"
                :party="party"
                class="party-chip"
              />
            </div>
            <v-icon
              class="flex-shrink-0"
              color="grey-darken-1"
              :icon="mdiChevronRight"
            />
          </div>
        </template>
      </v-list-item>

      <v-divider />
    </template>

    <v-list-item
      height="64"
      link
      title="Zobacz cały region"
      :subtitle="totalLabel"
      :to="`/eksploruj/tabela?teryt=${String(props.region.teryt).padStart(4, '0')}`"
    >
      <template #append>
        <v-icon
          class="align-self-center"
          color="grey-darken-1"
          :icon="mdiChevronRight"
        />
      </template>
    </v-list-item>
  </v-card>
</template>

<script lang="ts" setup>
import { mdiChevronRight, mdiClose } from "@mdi/js";
import { computed, nextTick, useTemplateRef, watch } from "vue";
import type { Powiat } from "~/composables/entity/regions";
import type { PersonRich } from "~~/shared/model";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { polishCounting, yearsOfWork } from "~/composables/polish";
import type { Query } from "~~/server/api/nodes/index.get";
import { generateEntityUrl } from "~/composables/slugs";

const props = defineProps<{
  region: Powiat | undefined;
}>();

/** A row of the list shown before anything is picked, passed up so it is
 * picked the way a click on the map is; and the way back to that list. */
const emit = defineEmits<{ pick: [region: Powiat]; reset: [] }>();

const title = useTemplateRef<{ $el: HTMLElement }>("title");
const regionsTop = useTemplateRef<{ focusFirstRow: () => void }>("regionsTop");

watch(
  () => props.region,
  async (region, previous) => {
    if (!region || region === previous) return;
    await nextTick();
    title.value?.$el.focus({ preventScroll: true });
  },
);

async function reset() {
  emit("reset");
  await nextTick();
  regionsTop.value?.focusFirstRow();
}

function subtitle(person: Partial<PersonRich>) {
  if (person.experience) {
    return yearsOfWork(person.experience);
  }
  if (person.stats?.nodeGroupSize) {
    return `${person.stats.nodeGroupSize} powiązanych osób`;
  }
  return "";
}

const apiQuery = computed(() => {
  return {
    type: "person",
    limit: 9,
    page: 1,
    teryt: props.region?.id ? props.region.id : undefined,
    sortBy: "experience",
    sortDesc: "true",
  } as Query;
});

const {
  tableItems: people,
  totalItems,
  pending: loading,
} = await useListWithStats(apiQuery, "people-list-data");

/** Counted from the same query that fills the list above, not from the map's
 * `region.people`. That stat is precomputed over approved people and approved
 * edges only, so for a signed-in user - who sees unapproved ones too - it
 * promised fewer rows than both this card and the table it links to. */
const totalLabel = computed(() =>
  loading.value
    ? ""
    : `(${polishCounting(totalItems.value, "powiązanie", "powiązania", "powiązań")})`,
);
</script>

<style scoped>
/* A place focus is sent, not a control: it says nothing to the reader to draw
   a ring round the card's whole header, as the browser does after a keyboard
   pick. */
.people-list__title:focus-visible {
  outline: none;
}

/* On the name's first line, not the middle of the block: a long name - „Powiat
   nowodworski (Nowy Dwór Mazowiecki)” - takes three lines on a phone, and a
   centred button floated beside the second. The 40px button is centred on
   the first 22px line. */
.people-list__close {
  margin-block: -9px;
}

/* Where the chips start wrapping: "PSL Polska 2050" (148px) is the widest pair
 * that still shares a line, and a third chip goes under them - two lines of
 * 24px inside the 64px row, and the name keeps the rest. Narrower is worse,
 * not better: at 7rem the same three chips took three lines, and the row does
 * not clip its append slot, so "SLD" was drawn on top of the next row. The
 * height cap is for that case - a fourth chip is cut off rather than bleeding
 * into the row below. */
.party-chips {
  max-width: 9.5rem;
  max-height: 3.25rem;
  overflow: hidden;
}

/* "Konfederacja", the widest party the site colours, is 110px and fits under
 * this whole; a longer one - "Bezpartyjni Samorządowcy" lands at exactly the
 * cap - ends in an ellipsis rather than taking the name's room. `PartyChip`
 * already clips its own text; this only gives it a width to clip at. */
.party-chip {
  max-width: 8rem;
}
</style>

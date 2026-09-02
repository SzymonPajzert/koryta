<template>
  <v-card
    v-if="!props.region"
    border
    class="pt-2 mt-2 mx-auto"
    max-width="400"
    rounded="lg"
  >
    <v-card-title> Analizuj powiązania </v-card-title>
    <v-card-text>
      <span class="d-none d-md-inline"
        >Wybierz region z mapy po lewej stronie, by zobaczyć powiązane
        osoby.</span
      >
      <span class="d-md-none"
        >Wybierz region z mapy na górze, by zobaczyć powiązane osoby.</span
      >
    </v-card-text>
  </v-card>
  <v-card v-else border class="pt-2 mt-2 mx-auto" max-width="400" rounded="lg">
    <v-card-title>
      {{ props.region.name }}
    </v-card-title>
    <v-divider />

    <template v-if="loading">
      <v-progress-circular indeterminate />
    </template>
    <v-card-text v-else-if="people.length === 0">
      Nie znaleźliśmy jeszcze osób w tym regionie.
    </v-card-text>
    <template v-for="person in people" v-else :key="person.name">
      <v-list-item
        height="64"
        link
        :title="person.name"
        :subtitle="subtitle(person)"
        :to="`/entity/person/${person.id}`"
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
import { mdiChevronRight } from "@mdi/js";
import { computed } from "vue";
import type { Powiat } from "~/composables/entity/regions";
import type { PersonRich } from "~~/shared/model";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { polishCounting } from "~/composables/polish";
import type { Query } from "~~/server/api/nodes/index.get";

const props = defineProps<{ region: Powiat | undefined }>();
function subtitle(person: Partial<PersonRich>) {
  if (person.experience) {
    return `${person.experience} lat pracy`;
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

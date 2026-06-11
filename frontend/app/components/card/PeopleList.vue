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
      <span class="d-none d-md-inline">Wybierz region z mapy po lewej stronie, by zobaczyć powiązane osoby.</span>
      <span class="d-md-none">Wybierz region z mapy na górze, by zobaczyć powiązane osoby.</span>
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
    <template v-for="person in people" v-else :key="person.name">
      <v-list-item
        height="64"
        link
        :title="person.name"
        :subtitle="subtitle(person)"
        :to="`/entity/person/${person.id}`"
      >
        <template #append>
          <div>
            <party-chip
              v-for="party in person.parties ?? []"
              :key="party"
              :party="party"
            />
            <v-icon color="grey-darken-1" :icon="mdiChevronRight" />
          </div>
        </template>
      </v-list-item>

      <v-divider />
    </template>

    <v-list-item
      height="64"
      link
      title="Zobacz cały region"
      :subtitle="`(${polishCounting(props.region.people ?? 0, 'powiązanie', 'powiązania', 'powiązań')})`"
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

const { tableItems: people, pending: loading } =
  await useListWithStats(apiQuery);
</script>

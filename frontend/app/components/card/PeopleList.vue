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
      Wybierz region z mapy po lewej stronie, by zobaczyć powiązane osoby.
    </v-card-text>
  </v-card>
  <v-card
    v-else-if="!loading && people.length === 0"
    border
    class="pt-2 mt-2 mx-auto"
    max-width="400"
    rounded="lg"
  >
    <v-card-title>
      {{ props.region.name }}
    </v-card-title>
    <v-card-text> Nie znaleźliśmy jeszcze osób w tym regionie.</v-card-text>
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
            <v-icon color="grey-darken-1" icon="mdi-chevron-right" />
          </div>
        </template>
      </v-list-item>

      <v-divider />
    </template>

    <v-list-item
      height="64"
      link
      title="Zobacz cały region"
      :subtitle="`(${props.region.people} powiązań)`"
      :to="`/entity/region/teryt${props.region.teryt}`"
    >
      <template #append>
        <v-icon
          class="align-self-center"
          color="grey-darken-1"
          icon="mdi-chevron-right"
        />
      </template>
    </v-list-item>
  </v-card>
</template>

<script lang="ts" setup>
import { useEntityListRich } from "~/composables/entity/listRich";
import type { Powiat } from "~/composables/entity/regions";
import type { PersonRich } from "~~/shared/model";

const props = defineProps<{ region: Powiat | undefined }>();
const { data: nodeGroups } = await authFetch("/api/graph/nodeGroups", {
  key: "peoplelist-node-groups",
});

function subtitle(person: Partial<PersonRich>) {
  if (person.experience) {
    return `${person.experience} lat pracy`;
  }
  const nodeGroup = nodeGroups.value?.find((group) => group.id == person.id);
  if (nodeGroup) {
    return `${nodeGroup.people} powiązanych osób`;
  }
  return "";
}
const { entities: places } = useEntities("place");
const { entities: regions } = useEntities("region");
const { people: peopleUnsorted, loading } = await useEntityListRich(
  ref(undefined),
  computed(() => {
    if (!props.region) return undefined;
    if (!props.region.id) return undefined;
    if (!props.region.name) return undefined;
    return ["teryt" + props.region.id, props.region.name];
  }),
  places,
  regions,
);

const people = computed(() => {
  const sorted = peopleUnsorted.value.toSorted((a, b) => {
    return b.experience - a.experience;
  });
  return sorted.slice(0, 9);
});
</script>

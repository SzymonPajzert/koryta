<template>
  <v-card border class="pt-2 mt-2 mx-auto" max-width="400" rounded="lg">
    <v-card-title>
      {{ region.name }}
    </v-card-title>
    <v-divider />

    <template v-for="person in people" :key="person.name">
      <v-list-item
        height="64"
        link
        :title="person.name"
        :subtitle="subtitle(person)"
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
      :subtitle="`(${region.people} powiązań)`"
      :to="`/entity/region/teryt${region.teryt}`"
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
import type { Powiat } from "~/composables/entity/regions";
import type { PersonRich } from "~~/shared/model";

const { region } = defineProps<{ region: Powiat }>();
const { data: nodeGroups } = await authFetch("/api/graph/nodeGroups");

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

const people: Partial<PersonRich>[] = [
  { name: "Rafał Trzaskowski", id: "8rg6MrDfdiRR7YaAvE5O", parties: ["PO"] },
  { name: "Michał Czaykowski", parties: ["PO"] },
  { name: "Robert Soszyński", parties: ["PO"] },
];
</script>

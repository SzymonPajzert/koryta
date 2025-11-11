<template>
  <div class="position-absolute top-0 ma-4">
    <v-card v-if="type == 'person'" width="100%">
      <v-card-title class="headline">
        <PartyChip v-for="party in person?.parties" :key="party" :party />
        <h2 class="text-h5 font-weight-bold">
          {{ person?.name }}
        </h2>
      </v-card-title>
    </v-card>
    <div class="mt-4">
      <v-row>
        <v-col
          v-for="edge in edges.filter((edge) =>
            ['employed', 'connection', 'owns'].includes(edge.type),
          )"
          :key="edge.richNode?.name"
          cols="12"
          md="6"
        >
          <CardShortNode :edge="edge" />
        </v-col>
      </v-row>
    </div>

    <div class="mt-4">
      <v-row>
        <v-col
          v-for="edge in edges.filter((edge) =>
            ['comment', 'mentions'].includes(edge.type),
          )"
          :key="edge.richNode?.name"
          cols="12"
          md="6"
        >
          <CardShortNode :edge="edge" />
        </v-col>
      </v-row>
    </div>

    <div class="mt-4">
      <v-btn
        variant="tonal"
        prepend-icon="mdi-pencil-outline"
        :href="`/edit/node/${node}`"
      >
        <template #prepend>
          <v-icon color="warning" />
        </template>
        Zaproponuj zmianę
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEdges } from "~/composables/edges";
import type { Person } from "~~/shared/model";
import { declination } from "~/composables/polish";

const route = useRoute<"/entity/[destination]/[id]">();
const node = computed(() => route.params.id as string);
const type = computed(() => route.params.destination);

const { sources, targets } = await useEdges(node, true);
const { data: person } = await useFetch<Person>("/api/nodes/person", {
  query: { id: node },
});

const edges = computed(() => [...sources, ...targets]);

useHead({
  title: computed(() => {
    const name = person.value?.name ?? "Nieznane";
    const connections =
      edges.value.length > 0
        ? `ma ${edges.value.length} ${declination(
            edges.value.length,
            "połączenie",
          )}`
        : "";
    return `${name} ${connections}`.trim();
  }),
});
</script>

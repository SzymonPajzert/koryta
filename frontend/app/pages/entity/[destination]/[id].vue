<template>
  <div class="position-absolute top-0 ma-4">
    <v-card v-if="type == 'person'" width="100%">
      <v-card-title class="headline">
        <PartyChip v-for="party in person?.parties" :key="party" :party />
        <h2 class="text-h5 font-weight-bold">
          {{ person?.name }}
        </h2>
      </v-card-title>
      <v-card-text>
        {{ person?.content }}
      </v-card-text>
    </v-card>

    <v-card v-if="type == 'place'" width="100%">
      <v-card-title class="headline">
        <v-icon start icon="mdi-office-building-outline" />
        <h2 class="text-h5 font-weight-bold d-inline">
          {{ person?.name }}
        </h2>
      </v-card-title>
      <v-card-text>
        <div v-if="(person as any)?.krsNumber" class="text-caption mb-2">
          KRS: {{ (person as any)?.krsNumber }}
        </div>
        {{ person?.content }}
      </v-card-text>
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
import { useAuthState } from "~/composables/auth";
import type { Person } from "~~/shared/model";
import { declination } from "~/composables/polish";

const route = useRoute<"/entity/[destination]/[id]">();

const node = route.params.id as string;
const type = route.params.destination;

// Use API fetch to ensure revisions are merged correctly (auth aware)
const { idToken } = useAuthState();
const headers = computed(() => {
  const h: Record<string, string> = {};
  if (idToken.value) {
    h.Authorization = `Bearer ${idToken.value}`;
  }
  return h;
});

const { data: response } = await useFetch<{ node: Person }>(
  `/api/nodes/entry/${node}`,
  {
    key: `node-entry-${node}-${idToken.value ? "auth" : "anon"}`,
    headers,
    watch: [headers],
  },
);
const person = computed(() => response.value?.node);

const { sources, targets } = await useEdges(node);
const edges = computed(() => [...sources.value, ...targets.value]);

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

useSeoMeta({
  title: () =>
    person.value?.name ? `${person.value.name} - Koryta.pl` : "Koryta.pl",
  ogTitle: () =>
    person.value?.name ? `${person.value.name} - Koryta.pl` : "Koryta.pl",
  description: () =>
    person.value?.content ||
    (person.value?.name
      ? `Informacje o ${person.value.name} w serwisie Koryta.pl`
      : "Koryta.pl - agregator informacji o politycznych układach"),
  ogDescription: () =>
    person.value?.content ||
    (person.value?.name
      ? `Informacje o ${person.value.name} w serwisie Koryta.pl`
      : "Koryta.pl - agregator informacji o politycznych układach"),
});
</script>

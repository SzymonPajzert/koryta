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
import { getFirestore, doc } from "firebase/firestore";
import { useEdges } from "~/composables/edges";
import { useAuthState } from "~/composables/auth";
import type { Person } from "~~/shared/model";

const route = useRoute<"/entity/[destination]/[id]">();

const node = route.params.id as string;
const type = route.params.destination;

const db = getFirestore(useFirebaseApp(), "koryta-pl");
// const person = useDocument<Person>(doc(db, "nodes", node));

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
</script>

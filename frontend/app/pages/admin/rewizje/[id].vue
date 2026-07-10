<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn
        icon="mdi-arrow-left"
        variant="text"
        class="mr-2"
        @click="router.back()"
      ></v-btn>
      <h1 class="text-h4">Szczegóły rewizji dla węzła {{ route.params.id }}</h1>
    </div>

    <v-card v-if="pending" class="pa-4 text-center">
      <v-progress-circular indeterminate></v-progress-circular>
    </v-card>
    <v-card v-else>
      <v-data-table
        :headers="headers"
        :items="allRevisions"
        :sort-by="[{ key: 'update_time', order: 'desc' }]"
      >
        <template #[`item.id`]="{ item }">
          <span class="text-caption font-weight-mono">{{ item.id }}</span>
        </template>
        <template #[`item.update_time`]="{ item }">
          {{ formatDate(item.update_time) }}
        </template>
        <template #[`item.update_automatic`]="{ item }">
          <v-chip
            :color="item.update_automatic ? 'info' : 'secondary'"
            size="small"
          >
            {{ item.update_automatic ? "Automatyczna" : "Ręczna" }}
          </v-chip>
        </template>
        <template #[`item.update_user`]="{ item }">
          <span class="text-caption">{{ item.update_user }}</span>
        </template>
        <template #[`item.data`]="{ item }">
          <pre
            class="text-caption"
            style="max-height: 200px; overflow-y: auto"
            >{{ JSON.stringify(item.data, null, 2) }}</pre
          >
        </template>
      </v-data-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useFirestore,
  useCollection,
  useIsCurrentUserLoaded,
  useCurrentUser,
} from "vuefire";
import { collection, query, where, orderBy } from "firebase/firestore";

definePageMeta({
  middleware: "auth",
  fullWidth: true,
});

useHead({
  title: "Szczegóły rewizji - koryta.pl",
});

const route = useRoute();
const router = useRouter();
const db = useFirestore();
const nodeId = route.params.id as string;

const isAuthReady = useIsCurrentUserLoaded();

const revisionsByNode_id = useCollection(
  computed(() =>
    isAuthReady.value
      ? query(collection(db, "revisions"), where("node_id", "==", nodeId))
      : null,
  ),
);

const revisionsByNodeId = useCollection(
  computed(() =>
    isAuthReady.value
      ? query(collection(db, "revisions"), where("nodeId", "==", nodeId))
      : null,
  ),
);

const allRevisions = computed(() => {
  const merged = [
    ...(revisionsByNode_id.value || []),
    ...(revisionsByNodeId.value || []),
  ];
  // Deduplicate by ID just in case
  const map = new Map();
  for (const rev of merged) {
    if (rev && rev.id) {
      map.set(rev.id, rev);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const timeA = new Date(parseTime(a.update_time)).getTime();
    const timeB = new Date(parseTime(b.update_time)).getTime();
    return timeB - timeA;
  });
});

const pending = computed(() => {
  return (
    !isAuthReady.value ||
    revisionsByNode_id.pending.value ||
    revisionsByNodeId.pending.value
  );
});

const headers = [
  { title: "ID", key: "id", sortable: false },
  { title: "Data modyfikacji", key: "update_time", sortable: true },
  { title: "Użytkownik", key: "update_user", sortable: true },
  { title: "Rodzaj", key: "update_automatic", sortable: true },
  { title: "Dane", key: "data", sortable: false },
];

function parseTime(val: unknown): string | number {
  if (!val) return 0;
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    if (typeof (val as { toDate?: () => unknown }).toDate === "function")
      return (val as { toDate: () => { toISOString: () => string } })
        .toDate()
        .toISOString();
    if (
      "_seconds" in val &&
      typeof (val as { _seconds: number })._seconds === "number"
    )
      return (val as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

function formatDate(val: unknown) {
  const time = parseTime(val);
  if (!time) return "-";
  return new Date(time).toLocaleString("pl-PL");
}
</script>

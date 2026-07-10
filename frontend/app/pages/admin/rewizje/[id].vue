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
    <div v-else class="overflow-x-auto pb-4">
      <client-only>
        <table v-if="allRevisions.length > 0" class="comparison-table">
          <thead>
            <tr>
              <th
                v-for="rev in allRevisions"
                :key="'h-' + rev.id"
                class="card-header text-left"
              >
                <div class="d-flex justify-space-between align-start mb-2">
                  <div>
                    <div class="text-h6 font-weight-medium">
                      {{ formatDate(rev.update_time) }}
                    </div>
                    <div class="text-caption text-grey-darken-1">
                      {{ rev.update_user || "Nieznany" }}
                    </div>
                  </div>
                  <v-chip
                    :color="rev.update_automatic ? 'info' : 'secondary'"
                    size="x-small"
                    class="mt-1"
                  >
                    {{ rev.update_automatic ? "Auto" : "Ręczna" }}
                  </v-chip>
                </div>
                <div class="text-caption font-weight-mono text-grey">
                  ID: {{ rev.id }}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in allKeys" :key="key">
              <td
                v-for="rev in allRevisions"
                :key="key + '-' + rev.id"
                class="card-cell"
              >
                <div
                  class="field-label text-caption text-primary font-weight-bold mb-1"
                >
                  {{ key }}
                </div>
                <div class="field-value text-body-2">
                  <template v-if="rev.data && rev.data[key] !== undefined">
                    <pre
                      class="mb-0"
                      style="white-space: pre-wrap; font-family: inherit"
                      >{{
                        typeof rev.data[key] === "object"
                          ? JSON.stringify(rev.data[key], null, 2)
                          : rev.data[key]
                      }}</pre
                    >
                  </template>
                  <template v-else>
                    <span class="text-grey-lighten-1 font-italic"
                      >- brak -</span
                    >
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <v-card v-else class="pa-6 text-center text-grey">
          Brak rewizji dla tego węzła.
        </v-card>
      </client-only>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useCollection, useIsCurrentUserLoaded, useFirebaseApp } from "vuefire";
import { collection, query, where, getFirestore } from "firebase/firestore";
import { ClientOnly } from "#components";

definePageMeta({
  middleware: "auth",
  fullWidth: true,
});

useHead({
  title: "Szczegóły rewizji - koryta.pl",
});

const route = useRoute();
const router = useRouter();
const firebaseApp = useFirebaseApp();
const db = getFirestore(firebaseApp, "koryta-pl");
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
  const merged = [...revisionsByNode_id.value, ...revisionsByNodeId.value];
  // Deduplicate by ID just in case
  const map = new Map();
  for (const rev of merged) {
    map.set(rev.id, rev);
  }
  return Array.from(map.values()).sort((a, b) => {
    const timeA = new Date(parseTime(a.update_time)).getTime();
    const timeB = new Date(parseTime(b.update_time)).getTime();
    return timeB - timeA;
  });
});

const allKeys = computed(() => {
  const keys = new Set<string>();
  for (const rev of allRevisions.value) {
    if (rev.data) {
      for (const k of Object.keys(rev.data)) {
        keys.add(k);
      }
    }
  }
  return Array.from(keys).sort();
});

const pending = computed(() => {
  return (
    !isAuthReady.value ||
    revisionsByNode_id.pending.value ||
    revisionsByNodeId.pending.value
  );
});

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

<style scoped>
.comparison-table {
  border-collapse: separate;
  border-spacing: 16px 0;
}
.comparison-table th,
.comparison-table td {
  width: 350px;
  min-width: 300px;
  max-width: 400px;
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  border-left: 1px solid rgba(0, 0, 0, 0.12);
  border-right: 1px solid rgba(0, 0, 0, 0.12);
  vertical-align: top;
}
.card-header {
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  padding-top: 20px;
}
.comparison-table tbody tr:last-child td {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
  padding-bottom: 20px;
}
.comparison-table tbody tr td {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}
</style>

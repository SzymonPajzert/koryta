<template>
  <div class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-btn
        :icon="mdiArrowLeft"
        variant="text"
        class="mr-2"
        to="/admin/rewizje"
      ></v-btn>
      <div>
        <h1 class="text-h4">
          Szczegóły rewizji: {{ nodeName || route.params.id }}
        </h1>
        <div v-if="nodeName" class="text-caption text-grey-darken-1">
          Węzeł {{ route.params.id }}
        </div>
      </div>
      <v-spacer />
      <div v-if="!pending" class="d-flex align-center ga-2">
        <v-chip
          :color="published ? 'success' : 'grey'"
          size="small"
          :prepend-icon="published ? mdiEarth : mdiEyeOffOutline"
        >
          {{ published ? "Opublikowana" : "Nieopublikowana" }}
        </v-chip>
        <v-btn
          v-if="isAdmin"
          :color="published ? 'grey' : 'success'"
          size="small"
          :loading="publishPending"
          :disabled="!published && !approvedRevisionId"
          @click="setPublished(!published)"
        >
          {{ published ? "Ukryj" : "Opublikuj" }}
          <v-tooltip
            v-if="!published && !approvedRevisionId"
            activator="parent"
            location="bottom"
            max-width="280"
          >
            Strona potrzebuje zatwierdzonej rewizji, żeby można było ją
            opublikować.
          </v-tooltip>
        </v-btn>
      </div>
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
                :class="{
                  'highlighted-revision': rev.id === route.query.revisionId,
                }"
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
                  <div class="d-flex flex-column align-end ga-1">
                    <v-chip
                      v-if="rev.id === approvedRevisionId"
                      color="success"
                      size="x-small"
                      :prepend-icon="mdiCheckDecagramOutline"
                    >
                      Zatwierdzona
                      <v-tooltip
                        activator="parent"
                        location="bottom"
                        max-width="280"
                      >
                        Ta wersja jest zatwierdzoną rewizją węzła (pole
                        revision_id). Widoczna publicznie tylko jeśli węzeł jest
                        opublikowany.
                      </v-tooltip>
                    </v-chip>
                    <v-chip
                      :color="rev.update_automatic ? 'info' : 'secondary'"
                      size="x-small"
                    >
                      {{ rev.update_automatic ? "Auto" : "Ręczna" }}
                    </v-chip>
                  </div>
                </div>
                <div class="mt-1">
                  <nuxt-link
                    v-if="getRevisionData(rev.data)['type']"
                    :to="`/entity/${getRevisionData(rev.data)['type']}/${nodeId}?revisionId=${rev.id}`"
                    class="text-decoration-none text-primary font-weight-bold d-inline-flex align-center ga-1"
                    target="_blank"
                  >
                    <v-icon :icon="mdiEyeOutline" size="small" />
                    Podgląd tej wersji strony
                    <v-tooltip
                      activator="parent"
                      location="bottom"
                      max-width="300"
                    >
                      Kliknij, aby zobaczyć, jak wyglądałaby strona po
                      opublikowaniu tej wersji.
                    </v-tooltip>
                  </nuxt-link>
                  <div class="text-caption font-weight-mono text-grey mt-1">
                    ID: {{ rev.id }}
                  </div>
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
                :class="{
                  'highlighted-revision': rev.id === route.query.revisionId,
                }"
              >
                <div
                  class="field-label text-caption text-primary font-weight-bold mb-1"
                >
                  {{ key }}
                </div>
                <div class="field-value text-body-2">
                  <template
                    v-if="
                      rev.data && getRevisionData(rev.data)[key] !== undefined
                    "
                  >
                    <pre
                      class="mb-0"
                      style="white-space: pre-wrap; font-family: inherit"
                      >{{
                        typeof getRevisionData(rev.data)[key] === "object"
                          ? JSON.stringify(
                              getRevisionData(rev.data)[key],
                              null,
                              2,
                            )
                          : getRevisionData(rev.data)[key]
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
import { computed, ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ClientOnly } from "#components";
import {
  mdiArrowLeft,
  mdiEyeOutline,
  mdiEyeOffOutline,
  mdiEarth,
  mdiCheckDecagramOutline,
} from "@mdi/js";

definePageMeta({
  middleware: "auth",
  fullWidth: true,
});

useHead({
  title: "Szczegóły rewizji - koryta.pl",
});

const route = useRoute();
const nodeId = route.params.id as string;

const { isAdmin } = useAuthState();

const revisions = ref<Record<string, unknown>[]>([]);
const approvedRevisionId = ref<string | null>(null);
const published = ref(false);
const pending = ref(true);
const publishPending = ref(false);

onMounted(async () => {
  try {
    const data = await $fetch<{
      revisions: Record<string, unknown>[];
      approvedRevisionId: string | null;
      published: boolean;
    }>("/api/revisions/byNode", { params: { nodeId } });
    revisions.value = data.revisions;
    approvedRevisionId.value = data.approvedRevisionId;
    published.value = data.published;
  } catch (err) {
    console.error("Failed to fetch revisions:", err);
  } finally {
    pending.value = false;
  }
});

async function setPublished(value: boolean) {
  publishPending.value = true;
  try {
    const result = await authRequest<{ published: boolean }>(
      "/api/nodes/publish",
      { body: { node_id: nodeId, published: value } },
    );
    published.value = result.published;
  } catch (err) {
    console.error("Failed to change publication state:", err);
  } finally {
    publishPending.value = false;
  }
}

const allRevisions = computed(() => {
  return [...revisions.value].sort((a, b) => {
    const timeA = new Date(parseTime(a.update_time)).getTime();
    const timeB = new Date(parseTime(b.update_time)).getTime();
    return timeB - timeA;
  });
});

// The node name isn't stored on the revision list directly, so derive it from
// the most recent revision that carries a `name` in its data snapshot. Names
// rarely change, so the latest available one is a safe label for the node.
const nodeName = computed<string | null>(() => {
  for (const rev of allRevisions.value) {
    const name = getRevisionData(rev.data)["name"];
    if (typeof name === "string" && name.trim()) {
      return name;
    }
  }
  return null;
});

const allKeys = computed(() => {
  const keys = new Set<string>();
  for (const rev of allRevisions.value) {
    if (rev.data && typeof rev.data === "object") {
      for (const k of Object.keys(rev.data as Record<string, unknown>)) {
        keys.add(k);
      }
    }
  }
  keys.delete("revision_id");
  return Array.from(keys).sort();
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

function getRevisionData(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return {};
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
.highlighted-revision {
  background: rgba(var(--v-theme-primary), 0.1) !important;
}
</style>

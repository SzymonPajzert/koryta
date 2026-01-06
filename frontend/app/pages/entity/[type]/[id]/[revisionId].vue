<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Szczegóły Rewizji</h1>
        <div v-if="loading">Ładowanie...</div>
        <div v-else-if="error">
          <v-alert type="error">Nie udało się załadować rewizji.</v-alert>
        </div>
        <div v-else-if="revisionData">
          <v-card class="mb-4">
            <v-card-title>
              Rewizja dla: {{ nodeData?.name || `ID: ${nodeId}` }}
            </v-card-title>
            <v-card-subtitle>
              Autor: {{ revisionData.update_user }} <br />
              Data: {{ new Date(revisionData.update_time).toLocaleString() }}
            </v-card-subtitle>
            <v-card-text>
              <h3 class="text-h6 mb-2">Dane rewizji:</h3>
              <pre class="bg-grey-lighten-4 pa-4 rounded">{{
                JSON.stringify(revisionData.data, null, 2)
              }}</pre>
            </v-card-text>
            <v-card-actions>
              <v-btn color="primary" variant="tonal" @click="applyRevision">
                Zatwierdź
              </v-btn>
              <v-btn color="error" variant="text" @click="rejectRevision">
                Odrzuć
              </v-btn>
            </v-card-actions>
          </v-card>

          <v-expansion-panels>
            <v-expansion-panel title="Aktualna wersja węzła">
              <v-expansion-panel-text>
                <pre class="bg-grey-lighten-4 pa-4 rounded">{{
                  JSON.stringify(nodeData, null, 2)
                }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
import type { Node, Revision } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const nodeId = route.params.id as string;
const revisionId = route.params.revisionId as string;

const { idToken } = useAuthState();
const headers = computed(() => {
  const h: Record<string, string> = {};
  if (idToken.value) {
    h.Authorization = `Bearer ${idToken.value}`;
  }
  return h;
});

// Fetch Revision
const {
  data: revisionData,
  pending: revLoading,
  error: revError,
} = await useFetch<Revision>(`/api/revisions/entry/${revisionId}`, {
  headers,
});

// Fetch Node (Current State)
const {
  data: nodeData,
  pending: nodeLoading,
  error: nodeError,
} = await useFetch<Node>(`/api/nodes/entry/${nodeId}`, {
  headers,
});

const loading = computed(() => revLoading.value || nodeLoading.value);
const error = computed(() => revError.value || nodeError.value);

async function applyRevision() {
  // Placeholder for apply logic
  // TODO https://github.com/SzymonPajzert/koryta/milestone/3
  alert("Funkcja zatwierdzania nie jest jeszcze w pełni zaimplementowana.");
}

async function rejectRevision() {
  // Placeholder for reject logic
  // TODO https://github.com/SzymonPajzert/koryta/milestone/3
  alert("Funkcja odrzucania nie jest jeszcze zaimplementowana.");
}
</script>

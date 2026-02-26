<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Szczegóły Rewizji</h1>
        <div v-if="loading">Ładowanie...</div>
        <div v-else-if="error">
          <v-alert type="error">Nie udało się załadować rewizji.</v-alert>
        </div>
        <v-card v-if="revisionData" class="mb-4">
          <v-card-title>
            Rewizja dla: {{ nodeData?.name || `ID: ${nodeId}` }}
          </v-card-title>
          <v-card-subtitle>
            Autor: {{ revisionData.update_user }} <br />
            Data:
            {{
              new Date(
                (revisionData.update_time as any)._seconds * 1000,
              ).toLocaleString()
            }}
          </v-card-subtitle>
          <v-card-text>
            <h3 class="text-h6 mb-2">Podgląd wersji:</h3>
            <EntityDetailsCard
              :entity="revisionData.data"
              :type="revisionData.data.type"
            />
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
              <EntityDetailsCard
                v-if="nodeData"
                :entity="nodeData"
                :type="nodeData.type"
              />
              <div v-else>Brak danych o aktualnej wersji.</div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import type { Node, Revision } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const route = useRoute();
const nodeId = route.params.id as string;
const revisionId = route.params.revisionId as string;

const { authFetch } = useAuthState();

// Fetch Revision
const {
  data: revisionData,
  pending: revLoading,
  error: revError,
} = await authFetch<Revision>(`/api/revisions/entry/${revisionId}`);

// Fetch Node (Current State)
const {
  data: nodeData,
  pending: nodeLoading,
  error: nodeError,
} = await authFetch<Node>(`/api/nodes/entry/${nodeId}`);

const loading = computed(() => revLoading.value || nodeLoading.value);
const error = computed(() => revError.value || nodeError.value);

async function applyRevision() {
  try {
    const { idToken } = useAuthState();
    await $fetch(`/api/revisions/entry/${revisionId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken.value}`,
      },
    });
    alert("Zatwierdzono rewizję!");

    // Redirect to entity page
    const targetType =
      revisionData.value?.data?.type || nodeData.value?.type || "person";
    // Clear cache for the node entry to ensure fresh data is fetched
    clearNuxtData((key) => key.includes(`/api/nodes/entry/${nodeId}`));

    useRouter().push(`/entity/${targetType}/${nodeId}`);
  } catch (e) {
    console.error(e);
    alert("Błąd podczas zatwierdzania rewizji.");
  }
}

async function rejectRevision() {
  // Placeholder for reject logic
  // TODO https://github.com/SzymonPajzert/koryta/milestone/3
  alert("Funkcja odrzucania nie jest jeszcze zaimplementowana.");
}
</script>

<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Lista Rewizji (Do Przejrzenia)</h1>
        <p v-if="loading" class="text-body-1">Ładowanie...</p>
        <p v-else-if="pendingNodes.length === 0" class="text-body-1">
          Brak stron oczekujących na zatwierdzenie.
        </p>
        <v-list v-else>
          <v-list-item
            v-for="node in pendingNodes"
            :key="node.id"
            :to="`/entity/${node.type}/${node.id}`"
            :title="node.name || 'Bez nazwy'"
            :subtitle="node.type"
          >
            <template #prepend>
              <v-icon :icon="iconMap[node.type] || 'mdi-help'" />
            </template>
            <template #append>
              <v-chip size="small" color="warning">Oczekuje</v-chip>
            </template>
          </v-list-item>
        </v-list>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
import type { Node } from "~~/shared/model";
import { nodeTypeIcon } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const { idToken } = useAuthState();
const headers = computed(() => {
  const h: Record<string, string> = {};
  if (idToken.value) {
    h.Authorization = `Bearer ${idToken.value}`;
  }
  return h;
});

const { data, pending: loading } = await useFetch<{
  nodes: Record<string, Node & { id: string }>;
}>("/api/nodes/pending", {
  headers,
});

const pendingNodes = computed(() => {
  return data.value ? Object.values(data.value.nodes) : [];
});

const iconMap = nodeTypeIcon;
</script>

<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Lista Rewizji (Do Przejrzenia)</h1>
        <p v-if="loading" class="text-body-1">Ładowanie...</p>
        <p v-else-if="pendingItems.length === 0" class="text-body-1">
          Brak elementów oczekujących na zatwierdzenie.
        </p>
        <v-list v-else>
          <v-list-item
            v-for="item in pendingItems"
            :key="item.id"
            :to="`/entity/${item.type}/${item.id}`"
            :title="item.name || getDefaultTitle(item)"
            :subtitle="getSubtitle(item)"
          >
            <template #prepend>
              <v-icon :icon="iconMap[item.type] || 'mdi-help'" />
            </template>
            <template #append>
              <v-chip size="small" color="warning"
                >{{ item.revisions.length }} Oczekuje</v-chip
              >
            </template>
          </v-list-item>
        </v-list>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
import type { Node, Edge } from "~~/shared/model";
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

const { data: nodesData, pending: nodesLoading } = await useFetch<
  Record<string, Node & { id: string }>
>("/api/nodes/pending", {
  headers,
});

const { data: edgesData, pending: edgesLoading } = await useFetch<
  Record<string, Edge & { id: string }>
>("/api/edges/pending", {
  headers,
});

const loading = computed(() => nodesLoading.value || edgesLoading.value);

const pendingItems = computed(() => {
  const nodes = nodesData.value ? Object.values(nodesData.value) : [];
  const edges = edgesData.value ? Object.values(edgesData.value) : [];
  return [...nodes, ...edges];
});

const iconMap: Record<string, string> = {
  ...nodeTypeIcon,
  employed: "mdi-briefcase-outline",
  connection: "mdi-connection",
  mentions: "mdi-account-voice",
  owns: "mdi-domain",
  comment: "mdi-comment-outline",
};

function getDefaultTitle(item: any) {
  if (item.source && item.target) {
    const s = item.source_name || item.source;
    const t = item.target_name || item.target;
    return `${item.type}: ${s} -> ${t}`;
  }
  return "Bez nazwy";
}

function getSubtitle(item: any) {
  if (item.source && item.target) {
    const s = item.source_name || item.source;
    const t = item.target_name || item.target;
    return `${item.type} (${s} -> ${t})`;
  }
  return item.type;
}
</script>

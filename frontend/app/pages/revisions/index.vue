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
          <v-list-group
            v-for="item in pendingItems"
            :key="item.id"
            :value="item.id"
          >
            <template #activator="{ props }">
              <v-list-item
                v-bind="props"
                :title="item.name || getDefaultTitle(item)"
                :subtitle="getSubtitle(item)"
              >
                <template #prepend>
                  <v-icon :icon="iconMap[item.type] || 'mdi-help'" />
                </template>
                <template #append>
                  <v-chip size="small" color="warning" class="ms-2">
                    {{ item.revisions.length }} Oczekuje
                  </v-chip>
                </template>
              </v-list-item>
            </template>

            <v-list-item
              v-for="rev in item.revisions"
              :key="rev.id"
              :to="`/entity/${item.type}/${item.id}/${rev.id}`"
              :title="`Rewizja z ${new Date(rev.update_time).toLocaleString()}`"
              :subtitle="`Autor: ${rev.update_user}`"
              prepend-icon="mdi-file-document-edit-outline"
            />
          </v-list-group>
        </v-list>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthState } from "@/composables/auth";
import type { Node, Edge, PageRevisioned } from "~~/shared/model";
import { nodeTypeIcon } from "~~/shared/model";

definePageMeta({
  middleware: "auth",
});

const { authFetch } = useAuthState();

const { data: nodesData, pending: nodesLoading } = await authFetch<
  Record<string, Node & PageRevisioned>
>("/api/nodes/pending");

const { data: edgesData, pending: edgesLoading } = await authFetch<
  Record<string, Edge & PageRevisioned>
>("/api/edges/pending");

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

type edgeLike = {
  type: string;
  source?: string;
  target?: string;
  source_name?: string;
  target_name?: string;
};

function getDefaultTitle(item: edgeLike) {
  if (item.source && item.target) {
    const s = item.source_name || item.source;
    const t = item.target_name || item.target;
    return `${item.type}: ${s} -> ${t}`;
  }
  return "Bez nazwy";
}

function getSubtitle(item: edgeLike) {
  if (item.source && item.target) {
    const s = item.source_name || item.source;
    const t = item.target_name || item.target;
    return `${item.type} (${s} -> ${t})`;
  }
  return item.type;
}
</script>

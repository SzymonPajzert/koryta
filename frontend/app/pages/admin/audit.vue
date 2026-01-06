<template>
  <v-container>
    <v-row>
      <v-col cols="12">
        <h1 class="text-h4 mb-4">Audyt danych</h1>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Krawędzie bez źródeł (artykułów)</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="edge in edgesWithoutArticles"
              :key="edge.id"
              :title="`${edge.source} -> ${edge.target}`"
              :subtitle="edge.type"
            >
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  icon="mdi-pencil"
                  :href="`/edit/node/${edge.source}`"
                />
              </template>
            </v-list-item>
            <v-list-item v-if="!edgesWithoutArticles.length">
              <v-list-item-title class="text-success">Wszystkie krawędzie mają źródła!</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card>
          <v-card-title>Artykuły bez powiązanych krawędzi</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="article in articlesWithoutEdges"
              :key="article.id"
              :title="article.name"
              :subtitle="article.id"
            >
              <template #append>
                <v-btn
                  size="small"
                  variant="text"
                  icon="mdi-eye"
                  :href="`/entity/article/${article.id}`"
                />
              </template>
            </v-list-item>
            <v-list-item v-if="!articlesWithoutEdges.length">
              <v-list-item-title class="text-success">Wszystkie artykuły są użyte jako źródła!</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthState } from "~/composables/auth";
import type { Edge, Node } from "~~/shared/model";

definePageMeta({
  middleware: "admin",
});

const { idToken } = useAuthState();
const headers = computed(() => {
  const h: Record<string, string> = {};
  if (idToken.value) {
    h.Authorization = `Bearer ${idToken.value}`;
  }
  return h;
});

const { data: edges } = await useFetch<Edge[]>("/api/graph/edges", {
  headers,
});

const { data: articlesResponse } = await useFetch<{ entities: Record<string, Node> }>(
  "/api/nodes/article",
  {
    headers,
  }
);

const edgesData = computed(() => edges.value || []);
const articles = computed(() => {
  const ents = articlesResponse.value?.entities || {};
  return Object.entries(ents).map(([id, data]) => ({ id, ...data }));
});

const edgesWithoutArticles = computed(() => {
  return edgesData.value.filter((e) => !e.references || e.references.length === 0);
});

const articlesWithoutEdges = computed(() => {
  const referencedArticleIds = new Set<string>();
  edgesData.value.forEach((e) => {
    e.references?.forEach((refId) => referencedArticleIds.add(refId));
  });

  return articles.value.filter((a) => !referencedArticleIds.has(a.id));
});
</script>

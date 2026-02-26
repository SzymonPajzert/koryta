<template>
  <div class="audit-view">
    <div v-if="loading" class="d-flex justify-center my-4">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else-if="items.length === 0" class="text-body-1 text-center my-4">
      Brak elementów do wyświetlenia.
    </div>
    <v-list v-else lines="two">
      <template v-for="item in items" :key="item.id">
        <!-- Grouped Revisions (for pending-revisions) -->
        <v-list-group v-if="item.isGroup" :value="item.id">
          <template #activator="{ props: activatorProps }">
            <v-list-item
              v-bind="activatorProps"
              :title="item.title"
              :subtitle="item.subtitle"
            >
              <template #prepend>
                <v-icon :icon="item.icon" />
              </template>
              <template #append>
                <v-chip size="small" color="warning" class="ms-2">
                  {{ item.children?.length }} Oczekuje
                </v-chip>
              </template>
            </v-list-item>
          </template>

          <v-list-item
            v-for="child in item.children"
            :key="child.id"
            :to="child.link"
            :title="child.title"
            :subtitle="child.subtitle"
            prepend-icon="mdi-file-document-edit-outline"
          />
        </v-list-group>

        <!-- Single Item (for other views) -->
        <v-list-item
          v-else
          :title="item.title"
          :subtitle="item.subtitle"
          :to="item.link"
          :href="item.href"
        >
          <template #prepend>
            <v-icon :icon="item.icon || 'mdi-circle-small'" />
          </template>
          <template #append>
            <v-btn
              v-if="type === 'my-revisions'"
              color="error"
              variant="text"
              size="small"
              :loading="revertingId === item.id"
              @click.stop="revertRevision(item.id)"
            >
              Wycofaj
            </v-btn>
            <v-btn
              v-else-if="item.actionIcon"
              size="small"
              variant="text"
              :icon="item.actionIcon"
              :to="item.link"
              :href="item.href"
            />
          </template>
        </v-list-item>
      </template>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import type { Node, Edge } from "~~/shared/model";
import { nodeTypeIcon } from "~~/shared/model";

const props = defineProps<{
  type:
    | "pending-revisions"
    | "edges-no-source"
    | "articles-no-edges"
    | "my-revisions";
}>();

const { user, authFetch, idToken } = useAuthState();
const revertingId = ref<string | null>(null);

// Data Types
type AuditItem = {
  id: string;
  title: string;
  subtitle: string;
  icon?: string;
  link?: string;
  href?: string;
  actionIcon?: string;
  isGroup?: boolean;
  children?: AuditItem[];
};

// --- Data Fetching ---

// 1. Pending Revisions
const { data: pendingNodes, pending: pendingNodesLoading } = authFetch<
  Record<string, any>
>(() => (props.type === "pending-revisions" ? "/api/nodes/pending" : null));

const { data: pendingEdges, pending: pendingEdgesLoading } = authFetch<
  Record<string, any>
>(() => (props.type === "pending-revisions" ? "/api/edges/pending" : null));

// 2. Edges (shared by 'edges-no-source' and 'articles-no-edges')
const { data: allEdges, pending: allEdgesLoading } = authFetch<Edge[]>(() =>
  ["edges-no-source", "articles-no-edges"].includes(props.type)
    ? "/api/graph/edges"
    : null,
);

// 3. Articles (for 'articles-no-edges')
const { data: allArticles, pending: allArticlesLoading } = authFetch<{
  entities: Record<string, Node>;
}>(() => (props.type === "articles-no-edges" ? "/api/nodes/article" : null));

// 4. My Revisions
const {
  data: myRevisionsData,
  pending: myRevisionsLoading,
  refresh: refreshMyRevisions,
} = authFetch<{
  items: any[];
}>(() =>
  props.type === "my-revisions" && user.value
    ? `/api/revisions/user/${user.value.uid}`
    : null,
);

// --- Computed Logic ---

const loading = computed(() => {
  if (props.type === "pending-revisions")
    return pendingNodesLoading.value || pendingEdgesLoading.value;
  if (props.type === "edges-no-source") return allEdgesLoading.value;
  if (props.type === "articles-no-edges")
    return allEdgesLoading.value || allArticlesLoading.value;
  if (props.type === "my-revisions") return myRevisionsLoading.value;
  return false;
});

const items = computed<AuditItem[]>(() => {
  if (props.type === "pending-revisions") {
    const nodes = pendingNodes.value ? Object.values(pendingNodes.value) : [];
    const edges = pendingEdges.value ? Object.values(pendingEdges.value) : [];
    return [...nodes, ...edges].map((p) => ({
      id: p.id,
      title: p.name || getDefaultTitle(p),
      subtitle: getSubtitle(p),
      icon: iconMap[p.type] || "mdi-help",
      isGroup: true,
      children: (p.revisions || []).map((rev: any) => ({
        id: rev.id,
        title: `Rewizja z ${new Date(rev.update_time).toLocaleString()}`,
        subtitle: `Autor: ${rev.update_user}`,
        link: `/entity/${p.type}/${p.id}/${rev.id}`,
      })),
    }));
  } else if (props.type === "edges-no-source") {
    const list = (allEdges.value || []).filter(
      (e) => !e.references || e.references.length === 0,
    );
    return list.map((e) => ({
      id: e.id || "",
      title: `${e.source} -> ${e.target}`,
      subtitle: e.type,
      icon: "mdi-connection",
      href: `/edit/node/${e.source}`,
      actionIcon: "mdi-pencil",
    }));
  } else if (props.type === "articles-no-edges") {
    const ents = allArticles.value?.entities || {};
    const articles = Object.entries(ents).map(([id, data]) => ({
      id,
      ...data,
    }));

    const referencedArticleIds = new Set<string>();
    (allEdges.value || []).forEach((e) => {
      e.references?.forEach((refId) => referencedArticleIds.add(refId));
    });

    const list = articles.filter((a) => !referencedArticleIds.has(a.id));
    return list.map((a) => ({
      id: a.id,
      title: a.name,
      subtitle: a.id,
      icon: "mdi-file-document-outline",
      href: `/entity/article/${a.id}`,
      actionIcon: "mdi-eye",
    }));
  } else if (props.type === "my-revisions") {
    return (
      myRevisionsData.value?.items.map((rev: any) => ({
        id: rev.id,
        title: `${rev.node_name || "Obiekt"} (${rev.name || "Edycja"})`,
        subtitle: `Złożono: ${new Date(rev.update_time).toLocaleString()}`,
        icon: "mdi-file-document-edit-outline",
        link: `/entity/${rev.node_type || "person"}/${rev.node_id}/${rev.id}`,
      })) || []
    );
  }
  return [];
});

// --- Actions ---

async function revertRevision(id: string) {
  if (!confirm("Czy na pewno chcesz wycofać tę propozycję?")) return;
  revertingId.value = id;
  try {
    const headers: Record<string, string> = {};
    if (idToken.value) {
      headers.Authorization = `Bearer ${idToken.value}`;
    }
    await $fetch(`/api/revisions/entry/${id}`, {
      method: "DELETE",
      headers,
    });

    // Refresh the revisions list
    if (props.type === "my-revisions") {
      refreshMyRevisions();
    }
  } catch (e) {
    alert("Nie udało się wycofać propozycji.");
    console.error(e);
  } finally {
    revertingId.value = null;
  }
}

// --- Helpers ---

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

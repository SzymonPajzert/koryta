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
import { useAuthState } from "@/composables/auth";
import type { Node, Edge } from "~~/shared/model";
import { nodeTypeIcon } from "~~/shared/model";

const props = defineProps<{
  type:
    | "pending-revisions"
    | "edges-no-source"
    | "articles-no-edges"
    | "my-revisions";
}>();

const { user, idToken, authFetch } = useAuthState();
const revertingId = ref<string | null>(null);

const authHeaders = computed(() => ({
  Authorization: idToken.value ? `Bearer ${idToken.value}` : "",
}));

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

const items = ref<AuditItem[]>([]);
const loading = ref(true);

// Fetch Data based on type
async function fetchData() {
  if (!user.value) {
    loading.value = false;
    items.value = [];
    return;
  }
  loading.value = true;
  try {
    items.value = [];

    if (props.type === "pending-revisions") {
      await fetchPendingRevisions();
    } else if (props.type === "edges-no-source") {
      await fetchEdgesNoSource();
    } else if (props.type === "articles-no-edges") {
      await fetchArticlesNoEdges();
    } else if (props.type === "my-revisions") {
      await fetchMyRevisions();
    }
  } catch (e) {
    console.error("Failed to fetch audit data", e);
  } finally {
    loading.value = false;
  }
}

// 1. Pending Revisions Logic
async function fetchPendingRevisions() {
  const [nodes, edges] = await Promise.all([
    $fetch<Record<string, any>>("/api/nodes/pending", {
      headers: authHeaders.value,
    }),
    $fetch<Record<string, any>>("/api/edges/pending", {
      headers: authHeaders.value,
    }),
  ]);

  const nodesList = nodes ? Object.values(nodes) : [];
  const edgesList = edges ? Object.values(edges) : [];
  const allPending = [...nodesList, ...edgesList];

  items.value = allPending.map((p) => ({
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
}

// 2. Edges No Source Logic
async function fetchEdgesNoSource() {
  const edges = await $fetch<Edge[]>("/api/graph/edges", {
    headers: authHeaders.value,
  });
  const list = (edges || []).filter(
    (e) => !e.references || e.references.length === 0,
  );

  items.value = list.map((e) => ({
    id: e.id || "",
    title: `${e.source} -> ${e.target}`,
    subtitle: e.type,
    icon: "mdi-connection",
    href: `/edit/node/${e.source}`,
    actionIcon: "mdi-pencil",
  }));
}

// 3. Articles No Edges Logic
async function fetchArticlesNoEdges() {
  const [edges, articlesResponse] = await Promise.all([
    $fetch<Edge[]>("/api/graph/edges", { headers: authHeaders.value }),
    $fetch<{ entities: Record<string, Node> }>("/api/nodes/article", {
      headers: authHeaders.value,
    }),
  ]);

  const edgesData = edges || [];
  const ents = articlesResponse?.entities || {};
  const articles = Object.entries(ents).map(([id, data]) => ({ id, ...data }));

  const referencedArticleIds = new Set<string>();
  edgesData.forEach((e) => {
    e.references?.forEach((refId) => referencedArticleIds.add(refId));
  });

  const list = articles.filter((a) => !referencedArticleIds.has(a.id));

  items.value = list.map((a) => ({
    id: a.id,
    title: a.name,
    subtitle: a.id,
    icon: "mdi-file-document-outline",
    href: `/entity/article/${a.id}`,
    actionIcon: "mdi-eye",
  }));
}

// 4. My Revisions Logic
async function fetchMyRevisions() {
  const myUid = user.value?.uid;
  if (!myUid) return;

  const data = await $fetch<{ items: any[] }>(`/api/revisions/user/${myUid}`, {
    headers: authHeaders.value,
  });
  const list = data?.items || [];

  items.value = list.map((rev: any) => ({
    id: rev.id,
    title: `${rev.node_name || "Obiekt"} (${rev.name || "Edycja"})`,
    subtitle: `Złożono: ${new Date(rev.update_time).toLocaleString()}`,
    icon: "mdi-file-document-edit-outline",
    link: `/entity/${rev.node_type || "person"}/${rev.node_id}/${rev.id}`,
  }));
}

// Revert Action
async function revertRevision(id: string) {
  if (!confirm("Czy na pewno chcesz wycofać tę propozycję?")) return;
  revertingId.value = id;
  try {
    await authFetch(`/api/revisions/entry/${id}`, {
      method: "DELETE",
    });
    // Refresh locally
    items.value = items.value.filter((i) => i.id !== id);
  } catch (e) {
    alert("Nie udało się wycofać propozycji.");
    console.error(e);
  } finally {
    revertingId.value = null;
  }
}

// Helpers
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

watch([() => props.type, user], fetchData, { immediate: true });
</script>

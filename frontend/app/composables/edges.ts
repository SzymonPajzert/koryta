import type { Node, Edge, EdgeType, ElectionPosition } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type: EdgeType;
  label: string;
  source: string;
  target: string;
  id?: string;
  traverse?: TraversePolicy;
  start_date?: string;
  end_date?: string;
  party?: string;
  committee?: string;
  position?: ElectionPosition;
  elected?: boolean;
  term?: string;
  by_election?: boolean;
};

const edgeTypeLabels: Record<string, string> = {
  employed: "Zatrudniony/a w",
  owns: "Właściciel",
  connection: "Powiązanie z",
  mentions: "Wspomina o",
  comment: "Komentarz",
  election: "Kandydował/a w",
};

export async function useEdges(nodeID: MaybeRefOrGetter<string | undefined>) {
  const url = computed(() => {
    const id = toValue(nodeID);
    return id ? `/api/graph/local/${id}?distance=1` : null;
  });

  const { user } = useAuthState();
  const { data: localData, refresh: refreshLocal } = await useAsyncData<any>(
    "local-graph" + (toValue(nodeID) || ""),
    async () => {
      const u = url.value;
      if (!u) return Promise.resolve(null);

      const headers = new Headers();
      if (user.value) {
        const token = await user.value.getIdToken();
        headers.set("Authorization", `Bearer ${token}`);
      }
      return $fetch(u, {
        headers,
        query: { latest: !!user.value },
      });
    },
    { watch: [url] },
  );

  const nodes = computed(() => localData.value?.nodes || {});
  const edges = computed(() => localData.value?.edges || []);

  const sources = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.target == id && nodes.value[e.source])
      .map((e: Edge) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: {
          ...nodes.value[e.source],
          type: nodes.value[e.source].entityType,
        } as Node,
      }));
  });
  const targets = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.source == id && nodes.value[e.target])
      .map((e: Edge) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: {
          ...nodes.value[e.target],
          type: nodes.value[e.target].entityType,
        } as Node,
      }));
  });
  const referencedIn = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e: Edge) => e.references?.includes(id))
      .map((e: Edge) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: {
          ...nodes.value[e.source],
          type: nodes.value[e.source].entityType,
        } as Node, // We show source node for referenced edges
      }));
  });

  async function refresh() {
    await refreshLocal();
  }

  return { sources, targets, referencedIn, refresh };
}

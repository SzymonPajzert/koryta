import type { Node, Edge } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type: "employed" | "connection" | "mentions" | "owns" | "comment";
  label: string;
  source: string;
  target: string;
  traverse?: TraversePolicy;
};

const edgeTypeLabels: Record<string, string> = {
  employed: "Zatrudniony/a w",
  owns: "Właściciel",
  connection: "Powiązanie z",
  mentions: "Wspomina o",
  comment: "Komentarz",
};

export async function useEdges(nodeID: MaybeRefOrGetter<string | undefined>) {
  const { idToken } = useAuthState();
  
  const headers = computed(() => {
    const h: Record<string, string> = {};
    if (idToken.value) {
      h.Authorization = `Bearer ${idToken.value}`;
    }
    return h;
  });

  const { data: edges, refresh: refreshEdges } = await useFetch<Edge[]>("/api/graph/edges", {
    key: `edges-${idToken.value ? 'auth' : 'anon'}`,
    headers,
    watch: [headers]
  });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: response, refresh: refreshNodes } = await useFetch<any>("/api/nodes", {
    key: `nodes-all-${idToken.value ? 'auth' : 'anon'}`,
    headers,
    watch: [headers]
  });
  
  const nodes = computed(() => response.value?.nodes || {});

  const sources = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e) => e.target == id && nodes.value[e.source])
      .map((e) => ({ 
        ...e, 
        label: e.name || edgeTypeLabels[e.type] || e.type, 
        richNode: nodes.value[e.source] as Node 
      }));
  });
  const targets = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e) => e.source == id && nodes.value[e.target])
      .map((e) => ({ 
        ...e, 
        label: e.name || edgeTypeLabels[e.type] || e.type, 
        richNode: nodes.value[e.target] as Node 
      }));
  });

  async function refresh() {
    await Promise.all([refreshEdges(), refreshNodes()]);
  }

  return { sources, targets, refresh };
}
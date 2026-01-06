import type { Node, Edge } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type: "employed" | "connection" | "mentions" | "owns" | "comment";
  label: string;
  source: string;
  target: string;
  id?: string;
  traverse?: TraversePolicy;
  start_date?: string;
  end_date?: string;
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

  const edgesData = useState<Edge[] | null>("edges-data-global", () => null);
  const { data: fetchedEdges, refresh: refreshEdges } = await useFetch<Edge[]>(
    "/api/graph/edges",
    {
      key: "edges-data-global",
      headers,
      watch: [headers],
    },
  );
  watch(
    fetchedEdges,
    (v) => {
      if (v) edgesData.value = v;
    },
    { immediate: true },
  );

  const nodesResponse = useState<{ nodes: Record<string, unknown> } | null>(
    "nodes-all-data-global",
    () => null,
  );
  const { data: fetchedNodes, refresh: refreshNodes } = await useFetch<{
    nodes: Record<string, unknown>;
  }>("/api/nodes", {
    key: "nodes-all-fetch-global",
    headers,
    watch: [headers],
  });
  watch(
    fetchedNodes,
    (v) => {
      if (v) nodesResponse.value = v;
    },
    { immediate: true },
  );

  const nodes = computed(() => nodesResponse.value?.nodes || {});
  const edges = computed(() => edgesData.value || []);

  const sources = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e) => e.target == id && nodes.value[e.source])
      .map((e) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: nodes.value[e.source] as Node,
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
        richNode: nodes.value[e.target] as Node,
      }));
  });

  async function refresh() {
    await Promise.all([refreshEdges(), refreshNodes()]);
  }

  return { sources, targets, refresh };
}

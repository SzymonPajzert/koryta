import type { Node, Edge } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type:
    | "employed"
    | "connection"
    | "mentions"
    | "owns"
    | "comment"
    | "election";
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
  election: "Kandydował/a w",
};

export async function useEdges(nodeID: MaybeRefOrGetter<string | undefined>) {
  const { authFetch } = useAuthState();

  const { data: edgesData, refresh: refreshEdges } =
    await authFetch<Edge[]>("/api/graph/edges");

  const { data: nodesResponse, refresh: refreshNodes } = await authFetch<{
    nodes: Record<string, unknown>;
  }>("/api/nodes");

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
  const referencedIn = computed<EdgeNode[]>(() => {
    const id = toValue(nodeID);
    if (!id) return [];
    return (edges.value || [])
      .filter((e) => e.references?.includes(id))
      .map((e) => ({
        ...e,
        label: e.name || edgeTypeLabels[e.type] || e.type,
        richNode: nodes.value[e.source] as Node, // We show source node for referenced edges
      }));
  });

  async function refresh() {
    await Promise.all([refreshEdges(), refreshNodes()]);
  }

  return { sources, targets, referencedIn, refresh };
}

import type { Node } from "~~/shared/model";
import type { TraversePolicy } from "~~/shared/graph/model";

export type EdgeNode = {
  richNode: Node;
  type: "employed" | "connection" | "mentions" | "owns" | "comment";
  label: string;
  source: string;
  target: string;
  traverse?: TraversePolicy;
};

export async function useEdges(nodeID: Ref<string>, lazy: boolean) {
  // TODO this should be a query for a local graph of a person
  const { data: graph } = await useFetch(`/api/graph/local/${nodeID.value}`, {
    lazy: lazy,
    pick: ["edges"],
  });
  const { data: nodes } = await useFetch<Record<string, Node>>("/api/nodes", {
    lazy: lazy,
  });

  const sources: EdgeNode[] = graph.value.edges
    .filter((e) => e.target == nodeID.value)
    .map((e) => ({ ...e, richNode: nodes.value.nodes[e.source] }));
  const targets = graph.value.edges
    .filter((e) => e.source == nodeID.value)
    .map((e) => ({ ...e, richNode: nodes.value.nodes[e.target] }));

  return { sources, targets };
}

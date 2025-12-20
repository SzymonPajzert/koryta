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

export async function useEdges(nodeID: string) {
  const { data: edges } = await useFetch("/api/graph/edges");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: response } = await useFetch<any>("/api/nodes");
  
  const nodes = computed(() => response.value?.nodes || {});

  const sources: EdgeNode[] = (edges.value || [])
    .filter((e) => e.target == nodeID && nodes.value[e.source])
    .map((e) => ({ ...e, richNode: nodes.value[e.source] as Node }));
  const targets: EdgeNode[] = (edges.value || [])
    .filter((e) => e.source == nodeID && nodes.value[e.target])
    .map((e) => ({ ...e, richNode: nodes.value[e.target] as Node }));

  return { sources, targets };
}

// function connectionText<D extends Destination>(connection: Connection<D>) {
//   if (connection.text != "") return connection.text;
//   if (connection.connection?.text && connection.relation != "") {
//     return connection.relation + " " + connection.connection?.text;
//   }
//   return "";
// }

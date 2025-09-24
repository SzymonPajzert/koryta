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
  const { data: nodes } = await useFetch<Record<string, Node>>("/api/nodes");

  const sources: EdgeNode[] = edges.value
    .filter((e) => e.target == nodeID)
    .map((e) => ({ ...e, richNode: nodes.value.nodes[e.source] }));
  const targets = edges.value
    .filter((e) => e.source == nodeID)
    .map((e) => ({ ...e, richNode: nodes.value.nodes[e.target] }));

  return { sources, targets };
}

// function connectionText<D extends Destination>(connection: Connection<D>) {
//   if (connection.text != "") return connection.text;
//   if (connection.connection?.text && connection.relation != "") {
//     return connection.relation + " " + connection.connection?.text;
//   }
//   return "";
// }

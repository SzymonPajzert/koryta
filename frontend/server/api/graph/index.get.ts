import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

export default defineEventHandler(async (event) => {
  const [people, places, articles, edgesFromDB] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchEdges(),
  ]);

  // TODO this is now calculated each time for each subgraph
  const nodesNoStats = getNodesNoStats(people, places, articles, partyColors);
  const edges = getEdges(edgesFromDB);
  const nodeGroups = getNodeGroups(nodesNoStats, edges, people, places);
  const nodes = getNodes(nodeGroups, nodesNoStats);

  const params = getQuery(event);
  if (
    params.subgraph &&
    typeof params.subgraph === "string" &&
    params.subgraph != ""
  ) {
    const matches = nodeGroups.filter((group) => group.id === params.subgraph);
    if (matches.length != 1) {
      throw Error("Unknown subgraph");
    }
    const subgraph = matches[0];
    return {
      edges: edges.filter(
        (edge) =>
          subgraph.connected.includes(edge.source) &&
          subgraph.connected.includes(edge.target),
      ),
      nodeGroups: [subgraph],
      nodes: Object.fromEntries(
        Object.entries(nodes).filter(([key]) =>
          subgraph.connected.includes(key),
        ),
      ),
    } as GraphLayout;
  }

  return {
    edges,
    nodeGroups,
    nodes,
  } as GraphLayout;
});

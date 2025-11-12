import { partyColors } from "~~/shared/misc";
import { getEdges, getNodeGroups, getNodesNoStats } from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

export default defineEventHandler(async (event) => {
  const subgraph = getRouterParam(event, "subgraph");
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

  const matches = nodeGroups.filter((group) => group.id === subgraph);
  if (matches.length != 1) {
    throw Error("Unknown subgraph");
  }
  const nodeGroup = matches[0];
  return { nodeGroup };
});

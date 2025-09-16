import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

export default defineEventHandler(async () => {
  const [people, places, articles, edgesFromDB] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("article"),
    fetchEdges(),
  ]);

  const nodesNoStats = getNodesNoStats(
    people,
    places,
    articles,
    partyColors,
  );
  const edges = getEdges(edgesFromDB);
  const nodeGroups = getNodeGroups(nodesNoStats, edges, people, places);
  const nodes = getNodes(nodeGroups, nodesNoStats);

  return { nodesNoStats, edges, nodeGroups, nodes } as GraphLayout;
});

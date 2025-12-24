import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { getUser } from "~~/server/utils/auth";

export default defineEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;

  const [people, places, articles, edgesFromDB] = await Promise.all([
    fetchNodes("person", { isAuth }),
    fetchNodes("place", { isAuth }),
    fetchNodes("article", { isAuth }),
    fetchEdges({ isAuth }),
  ]);

  const nodesNoStats = getNodesNoStats(people, places, articles, partyColors);
  const edges = getEdges(edgesFromDB);
  const nodeGroups = getNodeGroups(nodesNoStats, edges, people, places);
  const nodes = getNodes(nodeGroups, nodesNoStats);

  return {
    edges,
    nodeGroups,
    nodes,
  } as GraphLayout;
});

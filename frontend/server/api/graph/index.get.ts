import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";
import { authCachedEventHandler } from "~~/server/utils/handlers";

export default authCachedEventHandler(async (event) => {
  const user = await getUser(event).catch(() => null);
  const isAuth = !!user;

  const [people, places, regions, edgesFromDB] = await Promise.all([
    fetchNodes("person", { isAuth }),
    fetchNodes("place", { isAuth }),
    fetchNodes("region", { isAuth }),
    fetchEdges({ isAuth }),
  ]);

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));
  const edgesFiltered = edgesFromDB.filter(
    (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
  );
  const edges = getEdges(edgesFiltered);
  const nodeGroups = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );
  const nodes = getNodes(nodeGroups, nodesNoStats);

  return {
    edges,
    nodeGroups,
    nodes,
  } as GraphLayout;
});

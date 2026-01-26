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
  const nodeGroupsRaw = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );

  // Filter out empty regions/companies from nodeGroups
  const nodeGroups = nodeGroupsRaw.filter((group) => {
    // Keep "All" group (empty ID)
    if (!group.id) return true;
    
    // Authenticated users can see all groups (so they can link to empty companies)
    if (isAuth) return true;

    // For specific groups (regions/companies), check if they have people
    return group.stats.people > 0;
  });

  // Now we need to filter `nodes` to also exclude these empty entities so they don't show up in search/graph
  const validGroupIds = new Set(nodeGroups.map((g) => g.id));
  const nodesAll = getNodes(nodeGroups, nodesNoStats);

  // Filter nodes: keep if it's NOT a company/region OR if it IS a company/region that exists in validGroupIds
  const nodes = Object.fromEntries(
    Object.entries(nodesAll).filter(([key, node]) => {
      if (node.type === "rect" || node.type === "document") {
        return validGroupIds.has(key);
      }
      return true;
    }),
  );

  return {
    edges,
    nodeGroups,
    nodes,
  } as GraphLayout;
});

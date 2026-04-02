import { partyColors } from "~~/shared/misc";
import { getEdges, getNodeGroups, getNodesNoStats } from "~~/shared/graph/util";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { Edge } from "~~/shared/model";

import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

export default authCachedEventHandler(async () => {
  const [people, places, regions, edgesFromDB] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
    fetchEdges(),
  ]);

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));
  const edgesFiltered = edgesFromDB.filter(
    (e: Edge) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
  );
  const edges = getEdges(edgesFiltered);
  const nodeGroupsRaw = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );

  return nodeGroupsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    people: g.stats.people,
  }));
});

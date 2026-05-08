import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  getGraphBFS,
  type GraphLayout,
} from "~~/shared/graph/util";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { Edge } from "~~/shared/model";
import { getQuery, getRouterParam } from "h3";
import { fetchNodes, fetchEdges, fetchEdgesClose } from "~~/server/utils/fetch";

async function fetchEdgesSmaller(
  centerNodeId: string,
  distance: number,
): Promise<Edge[]> {
  if (distance == 1) {
    return fetchEdgesClose(centerNodeId);
  }

  return fetchEdges();
}

export async function getLocalGraph(
  focusNodeId: string,
  showUnapproved: boolean,
  distance: number,
  expansions: string[],
) {
  const [peopleRaw, placesRaw, regionsRaw, edgesFromDBRaw] = await Promise.all([
    fetchNodes("person", { bypassCache: false }),
    fetchNodes("place", { bypassCache: false }),
    fetchNodes("region", { bypassCache: false }),
    fetchEdgesSmaller(focusNodeId, distance),
  ]);

  // Handle visibility filtering
  const people = Object.fromEntries(
    Object.entries(peopleRaw).filter(([_, n]) =>
      showUnapproved ? true : n.visibility,
    ),
  );
  const places = Object.fromEntries(
    Object.entries(placesRaw).filter(([_, n]) =>
      showUnapproved ? true : n.visibility,
    ),
  );
  const regions = Object.fromEntries(
    Object.entries(regionsRaw).filter(([_, n]) =>
      showUnapproved ? true : n.visibility,
    ),
  );

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));

  const edgesFiltered = edgesFromDBRaw.filter(
    (e: Edge) =>
      (showUnapproved ? true : e.visibility) &&
      validNodeIds.has(e.source) &&
      validNodeIds.has(e.target),
  );

  const edges = getEdges(edgesFiltered);
  const nodeGroupsRaw = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );

  // Replicate interestingNodes filtering from frontend
  const nodesAll = getNodes(nodeGroupsRaw, nodesNoStats);
  const interestingNodes = Object.fromEntries(
    Object.entries(nodesAll).filter(([_, node]) => {
      if (node.type === "rect") {
        return node.stats.people > 0;
      }
      return true;
    }),
  );

  const focusIds = new Set([focusNodeId]);
  for (const id of expansions) {
    if (id) focusIds.add(id);
  }

  // Actually perform BFS from backend
  const localNodes = getGraphBFS(focusIds, distance, edges, interestingNodes);
  const validLocalIds = new Set(Object.keys(localNodes));

  // Determine local edges
  const localEdges = edges.filter(
    (e) => validLocalIds.has(e.source) && validLocalIds.has(e.target),
  );

  return {
    edges: localEdges,
    nodes: localNodes,
    // Filter node groups based on the fetched subgraph nodes if needed, or simply return empty if they aren't utilized.
    nodeGroups: nodeGroupsRaw.filter((g) => validLocalIds.has(g.id)),
  } as GraphLayout;
}

export default authCachedEventHandler(async (event) => {
  const query = getQuery(event);
  const _latest = query.latest !== undefined && query.latest !== "false";
  const distance = query.distance ? parseInt(query.distance as string, 10) : 1;
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  let expansions: string[] = [];
  if (query.expand) {
    expansions = (query.expand as string).split(",");
  }

  // TODO actually propagate the information about the latest
  return getLocalGraph(focusNodeId, false, distance, expansions);
});

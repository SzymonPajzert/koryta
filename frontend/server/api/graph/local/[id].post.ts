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
import { readBody, getRouterParam } from "h3";
import { fetchNodes, fetchEdges } from "~~/server/utils/fetch";

export default authCachedEventHandler(async (event) => {
  const body = await readBody(event) || {};
  const latest = body.latest !== undefined && body.latest !== false;
  const distance = body.distance ? parseInt(body.distance as string, 10) : 1;
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  const [peopleRaw, placesRaw, regionsRaw, edgesFromDBRaw] = await Promise.all([
    fetchNodes("person"),
    fetchNodes("place"),
    fetchNodes("region"),
    fetchEdges(),
  ]);

  // Handle visibility filtering
  const people = Object.fromEntries(
    Object.entries(peopleRaw).filter(([_, n]) =>
      latest ? true : n.visibility,
    ),
  );
  const places = Object.fromEntries(
    Object.entries(placesRaw).filter(([_, n]) =>
      latest ? true : n.visibility,
    ),
  );
  const regions = Object.fromEntries(
    Object.entries(regionsRaw).filter(([_, n]) =>
      latest ? true : n.visibility,
    ),
  );

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));

  const edgesFiltered = edgesFromDBRaw.filter(
    (e: Edge) =>
      (latest ? true : e.visibility) &&
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
  if (body.expand) {
    const expansions = typeof body.expand === "string" ? body.expand.split(",") : body.expand;
    for (const id of expansions) {
      if (id) focusIds.add(id);
    }
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
});

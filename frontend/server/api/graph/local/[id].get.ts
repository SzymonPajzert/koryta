import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  getGraphBFS,
  type GraphLayout,
} from "~~/shared/graph/util";
import { withCoCandidates } from "~~/shared/graph/coCandidates";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import type { Edge, Person, Company, Region } from "~~/shared/model";
import { getQuery, getRouterParam, type H3Event } from "h3";
import {
  fetchNodesByIds,
  fetchEdges,
  fetchEdgesClose,
} from "~~/server/utils/fetch";

async function fetchEdgesSmaller(
  centerNodeIds: string[],
  distance: number,
): Promise<Edge[]> {
  if (distance == 1) {
    return fetchEdgesClose(centerNodeIds);
  }

  return fetchEdges();
}

export async function getLocalGraph(
  focusNodeId: string,
  showUnapproved: boolean,
  distance: number,
  expansions: string[],
) {
  const focusIds = new Set([focusNodeId]);
  for (const id of expansions) {
    if (id) focusIds.add(id);
  }

  const edgesFromDBRaw = await fetchEdgesSmaller(
    Array.from(focusIds),
    distance,
  );

  const neededNodeIds = new Set<string>(focusIds);
  for (const edge of edgesFromDBRaw) {
    neededNodeIds.add(edge.source);
    neededNodeIds.add(edge.target);
  }

  const nodesRaw = await fetchNodesByIds(Array.from(neededNodeIds));

  const peopleRaw: Record<string, Person> = {};
  const placesRaw: Record<string, Company> = {};
  const regionsRaw: Record<string, Region> = {};

  for (const node of nodesRaw) {
    if (node.type === "person") peopleRaw[node.id!] = node;
    else if (node.type === "place") placesRaw[node.id!] = node;
    else if (node.type === "region") regionsRaw[node.id!] = node;
  }

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

  const nodesAll = getNodes(nodeGroupsRaw, nodesNoStats);

  // Actually perform BFS from backend
  const localNodes = getGraphBFS(focusIds, distance, edges, nodesAll);
  const validLocalIds = new Set(Object.keys(localNodes));

  // Determine local edges
  const localEdges = edges.filter(
    (e) => validLocalIds.has(e.source) && validLocalIds.has(e.target),
  );

  // Last, and after the node groups: two people who stood on the same list are
  // joined to each other rather than only to their district, but only when the
  // BFS above already put both of them on the page, and never in a way that
  // changes what counts as connected. See `shared/graph/coCandidates.ts`.
  return withCoCandidates({
    edges: localEdges,
    nodes: localNodes,
    // Filter node groups based on the fetched subgraph nodes if needed, or simply return empty if they aren't utilized.
    nodeGroups: nodeGroupsRaw.filter((g) => validLocalIds.has(g.id)),
  } as GraphLayout);
}

/** Whether the caller asked to be shown things that are not approved yet.
 *
 * `authFetch` sets it on every request a signed in reader makes, so it doubles
 * as "this is an editor", which is what decides the caching below. */
function wantsLatest(event: H3Event): boolean {
  const latest = getQuery(event).latest;
  return latest !== undefined && latest !== "false";
}

async function localGraph(event: H3Event) {
  const query = getQuery(event);
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
  return getLocalGraph(focusNodeId, wantsLatest(event), distance, expansions);
}

const cachedLocalGraph = authCachedEventHandler(localGraph);

export default defineEventHandler(async (event) => {
  // A signed in reader is the one who may have just added the edge they are
  // looking for, and the cache below holds a response for six hours - long
  // enough to convince somebody their relation was never written. So they read
  // through to Firestore, while logged out traffic, which is nearly all of it,
  // still gets the cache.
  if (wantsLatest(event)) {
    return localGraph(event);
  }
  return cachedLocalGraph(event);
});

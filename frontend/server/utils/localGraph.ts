import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  getGraphBFS,
  pruneOuterRing,
  type GraphLayout,
} from "~~/shared/graph/util";
import type { Edge, Person, Company, Region } from "~~/shared/model";
import {
  fetchNodesByIds,
  fetchEdgesClose,
  type NodeDataUnion,
} from "~~/server/utils/fetch";

/** One node's neighbourhood, as the canvas draws it.
 *
 * Split out of the route file so it can be tested without the nitro cache
 * wrapper the route builds at module scope - and because `[id].post.ts` reaches
 * for the same thing, which is a poor reason to import a GET handler.
 */
/** How many of the nodes one hop discovered may be asked about again.
 *
 * Each one costs two `in` queries per thirty, so the ceiling is on the fetch
 * rather than on the drawing - `pruneOuterRing` decides what survives to the
 * canvas. Forty is well past the number of relations any real person has and
 * still bounds the second hop at a couple of round trips. */
const FRONTIER_LIMIT = 40;

/** How many nodes the outer ring may draw before names start sitting on top of
 * one another. Shared out between the direct relations by `pruneOuterRing`. */
const RING_BUDGET = 28;

/** Which of the nodes a hop just discovered are worth asking about again.
 *
 * People and companies only. A region owns every institution inside it, so
 * following one turns "who does this person sit with" into "every company in
 * Małopolska": hundreds of nodes, none of them about the person, and the read
 * that fetches them is the whole-collection scan this function exists to avoid.
 * A region still gets drawn - it is a real relation of whatever reached it - it
 * just does not spread.
 *
 * Sorted by id before the cap so the same graph is cut the same way twice; an
 * arbitrary forty out of a Firestore result set would make a cached response
 * disagree with a fresh one. */
function expandableFrontier(nodes: NodeDataUnion[]): string[] {
  return nodes
    .filter((node) => node.type === "person" || node.type === "place")
    .map((node) => node.id)
    .filter((id): id is string => !!id)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, FRONTIER_LIMIT);
}

/** Every edge within `distance` relations of the focus nodes, and the node
 * documents fetched along the way.
 *
 * One hop at a time. `fetchEdgesClose` answers for thirty ids per pair of
 * queries, so a second hop is a handful of round trips - where the previous
 * shape of this, `distance === 1 ? fetchEdgesClose(...) : fetchEdges()`, read
 * the entire `edges` collection for anything deeper. That is tens of thousands
 * of documents on every uncached request, which is why nothing ever asked for
 * more than one hop.
 *
 * The nodes come back with the edges because deciding what to ask next needs
 * their `type` - and reading them here and again in the caller would bill the
 * whole first ring twice on every uncached request, in the one function whose
 * reason for existing is what a page costs to read. */
async function fetchNeighbourhood(
  focusIds: string[],
  distance: number,
): Promise<{ edges: Edge[]; nodes: Map<string, NodeDataUnion> }> {
  const edges = new Map<string, Edge>();
  const nodes = new Map<string, NodeDataUnion>();
  const seen = new Set(focusIds);
  let frontier = focusIds;

  for (let hop = 0; hop < distance && frontier.length > 0; hop++) {
    const found = await fetchEdgesClose(frontier);
    const discovered: string[] = [];
    for (const edge of found) {
      edges.set(edge.id ?? `${edge.source}|${edge.target}|${edge.type}`, edge);
      for (const end of [edge.source, edge.target]) {
        if (!seen.has(end)) {
          seen.add(end);
          discovered.push(end);
        }
      }
    }
    // The last hop only needs the edges; whatever it discovered sits beyond the
    // horizon and is dropped by the node filter below, so it is not worth a
    // read.
    if (hop + 1 >= distance || discovered.length === 0) break;

    const documents = await fetchNodesByIds(discovered);
    for (const node of documents) {
      if (node.id) nodes.set(node.id, node);
    }
    frontier = expandableFrontier(documents);
  }

  return { edges: Array.from(edges.values()), nodes };
}

/** `peers` are further nodes the layout is *about*, alongside `focusNodeId`.
 *
 * The table is the caller: a page of it is ten people who happen to share a
 * sort order, and it needs every one of their employers, not the first one's
 * plus whatever the other nine have in common with them. Passing them as
 * `expansions` instead would rank them a ring below the first row for no
 * reason a reader could see - and hand the nine rows' companies to the outer
 * ring budget, which would then drop most of them.
 */
export async function getLocalGraph(
  focusNodeId: string,
  showUnapproved: boolean,
  distance: number,
  expansions: string[],
  peers: string[] = [],
) {
  const subjectIds = [focusNodeId, ...peers.filter((id) => !!id)].filter(
    (id, at, all) => all.indexOf(id) === at,
  );
  const focusIds = new Set(subjectIds);
  for (const id of expansions) {
    if (id) focusIds.add(id);
  }

  const { edges: edgesFromDBRaw, nodes: alreadyFetched } =
    await fetchNeighbourhood(Array.from(focusIds), distance);

  const neededNodeIds = new Set<string>(focusIds);
  for (const edge of edgesFromDBRaw) {
    neededNodeIds.add(edge.source);
    neededNodeIds.add(edge.target);
  }

  // Whatever the walk above already read is not read again - on a two hop
  // request that is the whole of the first ring.
  const nodesRaw = [
    ...alreadyFetched.values(),
    ...(await fetchNodesByIds(
      Array.from(neededNodeIds).filter((id) => !alreadyFetched.has(id)),
    )),
  ].filter((node) => neededNodeIds.has(node.id!));

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
  const reachable = getGraphBFS(
    subjectIds,
    expansions.filter((id) => id && !subjectIds.includes(id)),
    distance,
    edges,
    nodesAll,
  );
  // Two hops out, one institution with a forty seat board is the whole picture
  // unless the ring is shared out. See `pruneOuterRing`.
  const { nodes: localNodes, omitted } = pruneOuterRing(
    reachable,
    edges,
    RING_BUDGET,
  );
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
    omitted,
  } as GraphLayout;
}

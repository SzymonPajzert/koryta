import type { TraversePolicy, Edge, Node, NodeStats } from "./model";
import { SPLIT } from "./model";
import type {
  Person,
  Company,
  Edge as DBEdge,
  EdgeType,
  Region,
} from "../model";
import { DiGraph } from "digraph-js";
import { personNode, companyNode, regionNode } from "./nodes";

export interface GraphLayout {
  edges: Edge[];
  nodeGroups: ReturnType<typeof getNodeGroups>;
  nodes: Record<string, Node & { stats: NodeStats }>;
}

export function getNodeGroups(
  nodesNoStats: Record<string, Node>,
  edges: ReturnType<typeof getEdges>,
  people: Record<string, Person>,
  companies: Record<string, Company>,
  regions: Record<string, Region>,
) {
  const placeConnection = new DiGraph();
  placeConnection.addVertices(
    ...Object.keys(nodesNoStats).flatMap((key) => [
      // Corresponds to TraverseState
      { id: key + SPLIT + "active", adjacentTo: [], body: {} },
      { id: key + SPLIT + "dead_end", adjacentTo: [], body: {} },
    ]),
  );

  edges.forEach((edge: Edge) => {
    if (!edge.traverse) {
      return;
    }
    // If the edge should spread the node group, either map it to active node or dead_end
    // Only active states have out-edges.
    if (edge.traverse.forward) {
      placeConnection.addEdge({
        from: edge.source + SPLIT + "active",
        to: edge.target + SPLIT + edge.traverse.forward,
      });
    }
    if (edge.traverse.backward) {
      placeConnection.addEdge({
        from: edge.target + SPLIT + "active",
        to: edge.source + SPLIT + edge.traverse.backward,
      });
    }
  });

  const entries = Object.entries({ ...companies, ...regions, ...people }).map(
    ([placeID, place]) => {
      const children = [
        ...placeConnection.getDeepChildren(placeID + SPLIT + "active"),
      ]
        // Remove node state from the ID.
        .map((extendedID) => extendedID.split(SPLIT)[0])
        .filter((id) => {
          if (!id) return false;
          return !nodesNoStats[id]?.hide;
        }) as string[];

      return {
        id: placeID,
        name: place.name,
        connected: [placeID, ...children],
        stats: {
          people: children.filter(
            (node) => nodesNoStats[node]?.type === "circle",
          ).length,
        },
      };
    },
  );
  entries.push({
    id: "",
    name: "Wszystkie",
    connected: Object.keys(nodesNoStats),
    stats: {
      people: Object.keys(people).length,
    },
  });
  return entries.sort((a, b) => b.stats.people - a.stats.people);
}

export function getNodes(
  nodeGroups: ReturnType<typeof getNodeGroups>,
  nodesNoStats: ReturnType<typeof getNodesNoStats>,
): Record<string, Node & { stats: NodeStats }> {
  const nodeGroupsMap = Object.fromEntries(nodeGroups.map((v) => [v.id, v]));

  return Object.fromEntries(
    Object.entries(nodesNoStats).map(([key, node]) => [
      key,
      {
        ...node,
        stats: nodeGroupsMap[key]?.stats ?? { people: 0 },
      },
    ]),
  );
}

export function getNodesNoStats(
  people: Record<string, Person>,
  companies: Record<string, Company>,
  regions: Record<string, Region>,
  partyColors: Record<string, string>,
): Record<string, Node> {
  const result: Record<string, Node> = {};
  Object.entries(people).forEach(([key, person]) => {
    result[key] = personNode(person, partyColors);
  });
  Object.entries(companies).forEach(([key, company]) => {
    result[key] = companyNode(company);
  });
  Object.entries(regions).forEach(([key, region]) => {
    result[key] = regionNode(region);
  });

  return result;
}

const edgeLabel: Record<EdgeType, string> = {
  employed: "pracuje",
  connection: "zna",
  mentions: "wspomina",
  owns: "właściciel",
  comment: "komentarz",
  election: "kandydował",
  tagged: "temat",
  aid: "pomoc publiczna",
};

const edgeTraverse: Record<EdgeType, TraversePolicy> = {
  employed: {
    forward: "active",
    backward: "dead_end",
  },
  connection: {
    forward: "active",
    backward: "active",
  },
  mentions: {
    forward: "dead_end",
    backward: "active",
  },
  owns: {
    forward: "active",
    backward: "dead_end",
  },
  comment: {
    forward: "dead_end",
    backward: "dead_end",
  },
  election: {
    forward: "dead_end",
    backward: "dead_end",
  },
  // Dead in both directions, and it has to stay that way. A topic is joined to
  // every article in its story, so a traversable `tagged` edge turns the topic
  // node into a hub two hops wide: everyone mentioned anywhere in an affair
  // would read as connected to everyone else, on `/graf` and on every entity
  // page. The topic view builds its own graph from the articles' `references`
  // instead, which is a claim somebody actually made.
  // Guarded by a test in `tests/shared/graph/util.test.ts`.
  tagged: {
    forward: "dead_end",
    backward: "dead_end",
  },
  // Dead in both directions, for the same reason as `tagged` and with more at
  // stake. An aid edge runs from the institution that paid to the company that
  // was paid, and the institutions are few: ZUS alone decided on 5692 grants
  // under SA.116730, to 2914 different companies. Traversable, that one node
  // would put every flood-aid beneficiary two hops from every other, which is
  // 4.2 million pairs of companies asserted to be connected by nothing more
  // than having filed with the same office. The current widest hub in the
  // database is a region node at 852 edges, so this would not be a difference
  // of degree.
  //
  // Being paid by the same institution is also not the kind of claim the graph
  // makes anywhere else: `owns` and `employed` are ties between the two ends,
  // while this is a transaction both ends had with the state. What is worth
  // reading off it - who got how much - is a number on the edge, and shows on
  // the company's own page without any traversal at all.
  //
  // Guarded by a test in `tests/shared/graph/util.test.ts`.
  aid: {
    forward: "dead_end",
    backward: "dead_end",
  },
};

export function getEdges(edgesFromDB: DBEdge[]) {
  return edgesFromDB.map((edge: DBEdge) => {
    const result: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.name ?? edgeLabel[edge.type],
      type: edge.type,
      traverse: edgeTraverse[edge.type],
      content: edge.content,
      name: edge.name,
      references: edge.references,
      visibility: edge.visibility,
      party: edge.party,
      committee: edge.committee,
      position: edge.position,
      elected: edge.elected,
      term: edge.term,
      by_election: edge.by_election,
      start_date: edge.start_date,
      end_date: edge.end_date,
      aidMeasure: edge.aidMeasure,
      aidGross: edge.aidGross,
      aidNominal: edge.aidNominal,
      aidDecisions: edge.aidDecisions,
    };
    return result;
  });
}

export function getGraphBFS(
  focusNodeIds: Set<string>,
  maxDepth: number,
  edges: Edge[],
  interestingNodes: Record<string, Node & { stats: NodeStats }>,
) {
  const visited = new Set<string>();

  const queue: { id: string; d: number }[] = [];
  for (const id of focusNodeIds) {
    queue.push({ id, d: 0 });
    visited.add(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.d >= maxDepth) continue;

    const neighbors = edges
      .filter((e) => e.source === current.id || e.target === current.id)
      .map((e) => (e.source === current.id ? e.target : e.source));

    for (const neighborId of neighbors) {
      if (!interestingNodes[neighborId]) {
        continue;
      }

      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, d: current.d + 1 });
      }
    }
  }

  return Object.fromEntries(
    Object.entries(interestingNodes).filter(([key]) => visited.has(key)),
  );
}

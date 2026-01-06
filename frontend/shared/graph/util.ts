import type { TraversePolicy, Edge, Node, NodeStats } from "./model";
import { SPLIT } from "./model";
import type {
  Person,
  Company,
  Article,
  Edge as DBEdge,
  EdgeType,
} from "@/../shared/model";
import { DiGraph } from "digraph-js";
import { getHostname } from "../misc";

export interface GraphLayout {
  edges: Edge[];
  nodeGroups: ReturnType<typeof getNodeGroups>;
  nodes: Record<string, Node & { stats: NodeStats }>;
}

export function getNodeGroups(
  nodesNoStats: ReturnType<typeof getNodesNoStats>,
  edges: ReturnType<typeof getEdges>,
  people: Record<string, Person>,
  companies: Record<string, Company>,
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
      // TODO console.error("no traverse policy in ", edge);
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

  const entries = Object.entries(companies).map(([placeID, place]) => {
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
        people: children.filter((node) => nodesNoStats[node]?.type === "circle")
          .length,
      },
    };
  });
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

//

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
  articles: Record<string, Article>,
  partyColors: Record<string, string>,
): Record<string, Node> {
  const result: Record<string, Node> = {};
  Object.entries(people).forEach(([key, person]) => {
    const party =
      person.parties && person.parties.length > 0
        ? (person.parties[0] ?? "")
        : "";
    const color = (
      party != "" ? partyColors[party] : "#4466cc"
    ) as Node["color"];
    result[key] = {
      ...person,
      type: "circle",
      color: color,
    };
  });

  Object.entries(companies).forEach(([key, company]) => {
    const entry: Node = {
      ...company,
      type: "rect",
      color: "gray",
    };

    result[key] = entry;
  });

  Object.entries(articles).forEach(([articleID, article]) => {
    const entry: Node = {
      name: article.shortName || getHostname(article),
      sizeMult: 1,
      type: "document",
      color: "pink",
    };
    result[articleID] = entry;
  });

  return result;
}

const edgeLabel: Record<EdgeType, string> = {
  employed: "pracuje",
  connection: "zna",
  mentions: "wspomina",
  owns: "właściciel",
  comment: "komentarz",
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
    };
    return result;
  });
}

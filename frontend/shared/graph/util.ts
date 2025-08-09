import type { TraversePolicy, Edge, Node, NodeStats } from "./model";
import { SPLIT } from "./model";
import type {
  Connection,
  NepoEmployment,
  Company,
  Article,
  Destination,
} from "@/../shared/model";
import { DiGraph } from "digraph-js";
import { getHostname } from "../misc";

export interface GraphLayout {
  nodesNoStats: Record<string, Node>;
  edges: Edge[];
  nodeGroups: ReturnType<typeof getNodeGroups>;
  nodes: Record<string, Node & { stats: NodeStats }>;
}

export function getNodeGroups(
  nodesNoStats: ReturnType<typeof getNodesNoStats>,
  edges: ReturnType<typeof getEdges>,
  people: Record<string, NepoEmployment>,
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
      console.error("no traverse policy in ", edge);
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
  people: Record<string, NepoEmployment>,
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
  if (companies) {
    Object.entries(companies).forEach(([key, company]) => {
      const entry: Node = {
        ...company,
        type: "rect",
        color: "gray",
      };

      result[key] = entry;
    });
  }
  if (articles) {
    Object.entries(articles).forEach(([articleID, article]) => {
      const mentionedPeople = article.estimates?.mentionedPeople ?? 1;
      const linkedPeople = article.people
        ? Object.keys(article.people).length
        : 0;
      const peopleLeft = Math.max(1, mentionedPeople - linkedPeople);
      const entry: Node = {
        name: article.shortName || getHostname(article),
        sizeMult: Math.pow(peopleLeft, 0.3),
        type: "document",
        color: "pink",
      };
      if (article.status && article.status.tags) {
        if (
          article.status.tags.includes("dodatkowe informacje") ||
          article.status.tags.includes("ludzie wyciągnięci") ||
          // TODO suppport multipeople
          article.status.tags.includes("przeczytane")
        ) {
          entry.color = "gray";
          entry.sizeMult = 0.6;
        }
        if (article.status.tags.includes("nie pokazuj w grafie")) {
          entry.hide = true;
        }
      }
      result[articleID] = entry;
    });
  }
  return result;
}

export function getEdges(
  people: Record<string, NepoEmployment>,
  companies: Record<string, Company>,
  articles: Record<string, Article>,
) {
  return executeGraph([
    relationFrom(people)
      .forEach((person) => person.employments)
      .setTraverse({ backward: "active", forward: "dead_end" })
      .edgeFromConnection(),

    relationFrom(people)
      .forEach((person) => person.connections)
      .setTraverse({ forward: "active", backward: "active" })
      .edgeFromConnection(),

    relationFrom(companies)
      .forField((company) => company.manager)
      .setTraverse({ forward: "active" })
      .edgeFrom((manager) => [manager.id, "zarządzający"]),
    relationFrom(companies)
      .forField((company) => company.owner)
      .setTraverse({ backward: "active" })
      .edgeFrom((owner) => [owner.id, "właściciel"]),
    relationFrom(companies)
      .forEach((company) => company.owners)
      .setTraverse({ backward: "active" })
      .edgeFrom((owner) => [owner.id, "właściciel"]),

    relationFrom(articles)
      .forEach((a) => a.people)
      .setTraverse({ forward: "dead_end", backward: "active" })
      .edgeFrom((person) => [person.id, "wspomina"]),
    relationFrom(articles)
      .forEach((a) => a.companies)
      .setTraverse({ forward: "dead_end", backward: "active" })
      .edgeFrom((company) => [company.id, "wspomina"]),
  ]);
}

type Closure<A> = (a: A) => void;

export function relationFrom<A>(
  relations: Record<string, A>,
  include: boolean = true,
): HalfEdgeMaker<A> {
  return new HalfEdgeMaker<A>((closure: Closure<[string, A]>) => {
    if (include) {
      Object.entries(relations).forEach(([key, relation]) => {
        closure([key, relation]);
      });
    }
  });
}

export class HalfEdgeMaker<A> {
  readonly outer: Closure<Closure<[string, A]>>;
  filter?: (elt: A) => boolean;

  constructor(outer: Closure<Closure<[string, A]>>) {
    this.outer = outer;
  }

  extractIf(predicate: (elt: A) => boolean) {
    this.filter = predicate;
    return this;
  }

  forEach<B>(
    extractor: (elt: A) => Record<string, B> | undefined,
  ): EdgeMaker<A, B> {
    return new EdgeMaker<A, B>(([result, mapper]) => {
      this.outer(([key, relation]) => {
        Object.values(extractor(relation) ?? {}).forEach((subRelation) => {
          const mapped = mapper(subRelation);
          if (mapped && (!this.filter || this.filter(relation))) {
            result.push({
              source: key,
              ...mapped,
            });
          }
        });
      });
    });
  }

  forField<B>(extractor: (elt: A) => B | undefined): EdgeMaker<A, B> {
    return new EdgeMaker<A, B>(([result, mapper]) => {
      this.outer(([key, relation]) => {
        const field = extractor(relation);
        if (field) {
          const mapped = mapper(field);
          if (mapped) {
            result.push({
              source: key,
              ...mapped,
            });
          }
        }
      });
    });
  }
}

type EdgeMissing = { target: string; label: string; traverse?: TraversePolicy };

class EdgeMaker<A, B> {
  traversePolicy?: TraversePolicy;

  readonly outer: Closure<[Edge[], (b: B) => EdgeMissing | undefined]>;

  constructor(outer: Closure<[Edge[], (b: B) => EdgeMissing | undefined]>) {
    this.outer = outer;
  }

  setTraverse(policy: TraversePolicy): EdgeMaker<A, B> {
    this.traversePolicy = policy;
    return this;
  }

  edgeFromConnection<D extends Destination>(): (results: Edge[]) => void {
    const policy = this.traversePolicy;
    return (results: Edge[]) => {
      this.outer([
        results,
        (b: B) => {
          const connection = b as Connection<D>;

          if (!connection.connection) {
            // TODO this should be reported somewhere
            return undefined;
          }

          return {
            target: connection.connection!.id,
            label: connection.relation,
            traverse: policy,
          };
        },
      ]);
    };
  }

  edgeFrom(extractor: (b: B) => [string, string]): (results: Edge[]) => void {
    const policy = this.traversePolicy;
    return (results: Edge[]) => {
      this.outer([
        results,
        (b: B) => {
          const [id, label] = extractor(b);
          return {
            target: id,
            label: label,
            traverse: policy,
          };
        },
      ]);
    };
  }
}

export function executeGraph(makers: ((results: Edge[]) => void)[]): Edge[] {
  const results: Edge[] = [];
  makers.forEach((maker) => {
    maker(results);
  });
  return results;
}

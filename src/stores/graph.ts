import { usePartyStatistics } from "@/composables/party";
import { createEntityStore } from "@/stores/entity";
import { getHostname } from "@/composables/entities/articles";
import type { Article, Connection } from "../composables/model";
import { DiGraph } from "digraph-js";

export interface Node {
  name: string;
  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number;
  hide?: boolean;
}

export interface NodeStats {
  people: number;
}

export interface NodeGroup {
  id: string;
  name: string;
  connected: string[];
  stats: NodeStats;
}

type TraverseState = "active" | "dead_end";
const SPLIT = "*split*" as const;

export interface TraversePolicy {
  // When filterting by place, should this relation be included?
  // What to do if you connect from this -> node
  forward?: TraverseState;
  // What to do if you connect from node -> this
  backward?: TraverseState;
}

export interface Edge {
  source: string;
  target: string;
  label: string;

  traverse?: TraversePolicy;
}

const useListEmployed = createEntityStore("employed");
const employedStore = useListEmployed();
const { entities: people } = storeToRefs(employedStore);

const useListCompanies = createEntityStore("company");
const companyStore = useListCompanies();
const { entities: companies } = storeToRefs(companyStore);

const useListData = createEntityStore("data");
const dataStore = useListData();
const { entities: articles } = storeToRefs(dataStore);

const { partyColors } = usePartyStatistics();

export const useGraphStore = defineStore("graph", () => {
  const nodesNoStats = computed(() => {
    const result: Record<string, Node> = {};
    Object.entries(people.value).forEach(([key, person]) => {
      result[key] = {
        ...person,
        type: "circle",
        color:
          person.parties && person.parties.length > 0
            ? partyColors.value[person.parties[0]]
            : "#4466cc",
      };
    });
    if (companies.value) {
      Object.entries(companies.value).forEach(([key, company]) => {
        const entry: Node = {
          ...company,
          type: "rect",
          color: "gray",
        };

        result[key] = entry;
      });
    }
    if (articles.value) {
      Object.entries(articles.value).forEach(([articleID, article]) => {
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
  });

  const edges = computed(() => {
    return executeGraph([
      relationFrom(people.value)
        .forEach((person) => person.employments)
        .setTraverse({ backward: "active", forward: "dead_end" })
        .edgeFromConnection(),

      relationFrom(people.value)
        .forEach((person) => person.connections)
        .setTraverse({ forward: "active", backward: "active" })
        .edgeFromConnection(),

      relationFrom(companies.value)
        .forField((company) => company.manager)
        .setTraverse({ forward: "active" })
        .edgeFrom((manager) => [manager.id, "zarządzający"]),
      relationFrom(companies.value)
        .forField((company) => company.owner)
        .setTraverse({ backward: "active" })
        .edgeFrom((owner) => [owner.id, "właściciel"]),
      relationFrom(companies.value)
        .forEach((company) => company.owners)
        .setTraverse({ backward: "active" })
        .edgeFrom((owner) => [owner.id, "właściciel"]),

      relationFrom(articles.value)
        .forEach((a) => a.people)
        .setTraverse({ forward: "dead_end", backward: "active" })
        .edgeFrom((person) => [person.id, "wspomina"]),
      relationFrom(articles.value)
        .forEach((a) => a.companies)
        .setTraverse({ forward: "dead_end", backward: "active" })
        .edgeFrom((company) => [company.id, "wspomina"]),
    ]);
  });

  const nodeGroups = computed<NodeGroup[]>(() => {
    const placeConnection = new DiGraph();
    placeConnection.addVertices(
      ...Object.keys(nodesNoStats.value).flatMap((key) => [
        // Corresponds to TraverseState
        { id: key + SPLIT + "active", adjacentTo: [], body: {} },
        { id: key + SPLIT + "dead_end", adjacentTo: [], body: {} },
      ]),
    );

    edges.value.forEach((edge: Edge) => {
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

    const entries = Object.entries(companies.value).map(([placeID, place]) => {
      const children = [
        ...placeConnection.getDeepChildren(placeID + SPLIT + "active"),
      ]
        // Remove node state from the ID.
        .map((extendedID) => extendedID.split(SPLIT)[0])
        .filter((id) => {
          try {
            return !nodesNoStats.value[id].hide;
          } catch (e) {
            console.error(
              "trying node",
              id,
              nodesNoStats.value[id],
              "got exception",
              e,
            );
            throw e;
          }
        });
      return {
        id: placeID,
        name: place.name,
        connected: [placeID, ...children],
        stats: {
          people: children.filter(
            (node) => nodesNoStats.value[node].type === "circle",
          ).length,
        },
      };
    });
    entries.push({
      id: "",
      name: "Wszystkie",
      connected: Object.keys(nodesNoStats.value),
      stats: {
        people: Object.keys(people.value).length,
      },
    });
    return entries.sort((a, b) => b.stats.people - a.stats.people);
  });

  const nodeGroupsMap = computed(() => {
    return Object.fromEntries(nodeGroups.value.map((v) => [v.id, v]));
  });

  const nodes = computed<Record<string, Node & { stats: NodeStats }>>(() => {
    return Object.fromEntries(
      Object.entries(nodesNoStats.value).map(([key, node]) => [
        key,
        {
          ...node,
          stats: nodeGroupsMap.value[key]?.stats ?? { people: 0 },
        },
      ]),
    );
  });

  return {
    nodesNoStats,
    edges,
    nodeGroups,
    nodeGroupsMap,
    nodes,
  };
});

type Closure<A> = (a: A) => void;

function relationFrom<A>(
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

class HalfEdgeMaker<A> {
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

  edgeFromConnection(): (results: Edge[]) => void {
    const policy = this.traversePolicy;
    return (results: Edge[]) => {
      this.outer([
        results,
        (b: B) => {
          const connection = b as Connection;

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

function executeGraph(makers: ((results: Edge[]) => void)[]): Edge[] {
  const results: Edge[] = [];
  makers.forEach((maker) => {
    maker(results);
  });
  return results;
}

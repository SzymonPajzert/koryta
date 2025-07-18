import { usePartyStatistics } from "@/composables/party";
import { useListEntity } from "@/composables/entity";
import { useArticles, getHostname } from "@/composables/entities/articles";
import type { Connection } from "../composables/model";
import { DiGraph } from "digraph-js";

export interface Node {
  name: string;
  type: "circle" | "rect" | "document";
  color: string;
  sizeMult?: number;
}

export interface NodeGroup {
  id: string;
  name: string;
  connected: string[];
  stats: {
    people: number;
  };
}

export interface TraversePolicy {
  // When filterting by place, should this relation be included?
  place: "forward" | "backward" | "bidirect";
}

export interface Edge {
  source: string;
  target: string;
  label: string;

  traverse?: TraversePolicy;
}

const { entities: people } = useListEntity("employed");
const { entities: companies } = useListEntity("company");
const { articles } = useArticles();

const { partyColors } = usePartyStatistics();

export const useGraphStore = defineStore("graph", () => {
  // TODO read this from user config or page config
  const showActiveArticles = ref(false);
  const showInactiveArticles = ref(false);
  const nodeGroupPicked = ref<NodeGroup | undefined>();

  // TODO reinstate it
  const showArticles = computed(
    () => showActiveArticles.value || showInactiveArticles.value,
  );

  const nodes = computed(() => {
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
        const entry : Node = {
          ...company,
          type: "rect",
          color: "gray",
        };
        if (nodeGroupPicked.value && nodeGroupPicked.value.id === key) {
          // We are centering on this node, increase its size
          entry.sizeMult = 3
          entry.color = "blue"
        }

        result[key] = entry
      });
    }
    if (articles.value) {
      Object.entries(articles.value).forEach(([articleID, article]) => {
        const mentionedPeople = article.estimates?.mentionedPeople ?? 1;
        const linkedPeople = article.people
          ? Object.keys(article.people).length
          : 0;
        const peopleLeft = Math.max(1, mentionedPeople - linkedPeople);
        result[articleID] = {
          name: article.shortName || getHostname(article),
          sizeMult: Math.pow(peopleLeft, 0.3),
          type: "document",
          color: "pink", // TODO the color should be based if the article is active or not
        };
      });
    }
    return result;
  });

  const edges = computed(() => {
    return executeGraph([
      relationFrom(people.value)
        .forEach((person) => person.employments)
        .setTraverse({ place: "backward" })
        .edgeFromConnection(),

      relationFrom(people.value)
        .forEach((person) => person.connections)
        .setTraverse({ place: "bidirect" })
        .edgeFromConnection(),

      relationFrom(companies.value)
        .forField((company) => company.manager)
        .setTraverse({ place: "forward" })
        .edgeFrom((manager) => [manager.id, "zarządzający"]),
      relationFrom(companies.value)
        .forField((company) => company.owner)
        .setTraverse({ place: "backward" })
        .edgeFrom((owner) => [owner.id, "właściciel"]),
      relationFrom(companies.value)
        .forEach((company) => company.owners)
        .setTraverse({ place: "backward" })
        .edgeFrom((owner) => [owner.id, "właściciel"]),

      // TODO How to stop the articles spreading too much?
      relationFrom(articles.value)
        .forEach((article) => article.people)
        .setTraverse({ place: "bidirect" })
        .edgeFrom((person) => [person.id, "wspomina"]),
      relationFrom(articles.value)
        .forEach((article) => article.companies)
        .setTraverse({ place: "bidirect" })
        .edgeFrom((company) => [company.id, "wspomina"]),
    ]);
  });

  const nodeGroups = computed<NodeGroup[]>(() => {
    const placeConnection = new DiGraph();
    placeConnection.addVertices(
      ...Object.keys(nodes.value).map((key) => ({
        id: key,
        adjacentTo: [],
        body: {},
      })),
    );

    edges.value.forEach((edge: Edge) => {
      if (!edge.traverse) {
        console.error("no traverse policy in ", edge);
        return;
      }
      if (edge.traverse.place == "forward") {
        placeConnection.addEdge({ from: edge.source, to: edge.target });
      } else if (edge.traverse.place == "backward") {
        placeConnection.addEdge({ from: edge.target, to: edge.source });
      } else if (edge.traverse.place == "bidirect") {
        placeConnection.addEdge({ from: edge.source, to: edge.target });
        placeConnection.addEdge({ from: edge.target, to: edge.source });
      }
    });

    const entries = Object.entries(companies.value).map(([placeID, place]) => {
      const children = [...placeConnection.getDeepChildren(placeID)];
      return {
        id: placeID,
        name: place.name,
        connected: [placeID, ...children],
        stats: {
          people: children.filter((node) => nodes.value[node].type === "circle")
            .length,
        },
      };
    });
    entries.push({
      id: "",
      name: "Wszystkie",
      connected: Object.keys(nodes.value),
      stats: {
        people: Object.keys(people.value).length,
      },
    });
    return entries.sort((a, b) => b.stats.people - a.stats.people);
  });

  const nodesFiltered = computed(() => {
    if (nodeGroupPicked.value) {
      return Object.fromEntries(
        Object.entries(nodes.value).filter(([key, _]) =>
          nodeGroupPicked.value?.connected.includes(key),
        ),
      );
    }
    return nodes.value;
  });

  return {
    nodes,
    edges,
    nodeGroups,
    showActiveArticles,
    showInactiveArticles,
    nodeGroupPicked,
    nodesFiltered,
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

  constructor(outer: Closure<Closure<[string, A]>>) {
    this.outer = outer;
  }

  forEach<B>(
    extractor: (elt: A) => Record<string, B> | undefined,
  ): EdgeMaker<A, B> {
    return new EdgeMaker<A, B>(([result, mapper]) => {
      this.outer(([key, relation]) => {
        Object.values(extractor(relation) ?? {}).forEach((subRelation) => {
          const mapped = mapper(subRelation);
          if (mapped) {
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

import { readFileSync } from "node:fs";
import {
  indexOffices,
  officeChoices,
  parseOffices,
  type RegionOffices,
} from "../../../shared/offices";

/** Powiat wejherowski, the powiat the /qa entry walks through. The seed has no
 * region for it, so the spec answers the search that finds it and the
 * endpoint that lists its urzędy. */
export const POWIAT = {
  id: "teryt2215",
  name: "Powiat wejherowski",
  type: "region",
  published: true,
};

const table = indexOffices(
  parseOffices(
    readFileSync(
      new URL(
        "../../../server/assets/local_government_offices.jsonl",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

/** What /api/nodes/teryt2215/offices answers: the starostwo and the urzędy of
 * the ten gminy, built from the shipped table with the functions the endpoint
 * uses. None of them has a node on the site, so a place proposed for any of
 * them is seated in the powiat. */
export const powiatOffices: RegionOffices = {
  offices: officeChoices(table, "2215").map(({ office, gmina }) => ({
    ...office,
    node: null,
    gmina,
    seatId: POWIAT.id,
  })),
};

type Graph = {
  nodes: Record<string, Record<string, unknown>>;
  edges: Record<string, unknown>[];
};

/** A person's graph with a post in an urząd added to it, as the relation
 * dialog files one: an `employed` edge to a public place named after the
 * office.
 *
 * Copied from the person's own relation to a place and its far end, so the row
 * has every field the graph endpoint gives one, and stripped of what would say
 * more than the urząd does - that relation's sources, its election details,
 * the place's register number and sectors. */
export function withUrzad(graph: Graph, personId: string): Graph {
  const edge = graph.edges.find(
    (e) =>
      e.source === personId &&
      graph.nodes[String(e.target)]?.entityType === "place",
  );
  if (!edge) {
    throw new Error(`person ${personId} has no place to copy an urząd from`);
  }
  const place = graph.nodes[String(edge.target)]!;
  const id = "urzad-miasta-opola";
  return {
    nodes: {
      ...graph.nodes,
      [id]: {
        ...place,
        id,
        name: "Urząd Miasta Opola",
        isPublic: true,
        regonNumber: "000584805",
        krsNumber: undefined,
        categories: [],
      },
    },
    edges: [
      ...graph.edges,
      {
        ...edge,
        id: "urzad-miasta-opola-zastepca",
        target: id,
        type: "employed",
        name: "zastępca prezydenta miasta",
        references: [],
        start_date: undefined,
        end_date: undefined,
        party: undefined,
        committee: undefined,
        position: undefined,
        elected: undefined,
        term: undefined,
        by_election: undefined,
      },
    ],
  };
}

import type { RegionOffices } from "../../../shared/offices";

/** Powiat wejherowski, the powiat the /qa entry walks through. The seed has no
 * region for it, so the spec answers the search that finds it and the
 * endpoint that lists its urzędy. */
export const POWIAT = {
  id: "teryt2215",
  name: "Powiat wejherowski",
  type: "region",
  published: true,
};

/** What /api/nodes/teryt2215/offices answers: the starostwo alone, as the
 * powiat's node carries it. Every gmina is a region of its own, so none of
 * theirs is listed (decision on 2026-11-22). The site has no place for it, so
 * one proposed for it is seated in the powiat. */
export const powiatOffices: RegionOffices = {
  offices: [
    {
      teryt: "2215",
      region: "wejherowski",
      name: "Starostwo Powiatowe w Wejherowie",
      regon: "191686414",
      nip: "5881831062",
      node: null,
      seatId: POWIAT.id,
    },
  ],
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

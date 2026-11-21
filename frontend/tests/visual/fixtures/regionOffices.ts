import {
  indexOffices,
  officeChoices,
  type RegionOffice,
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

/** The powiat's urzędy as its node carries them in `offices`: the starostwo
 * and the urzędy of its ten gminy, as the LocalGovernmentOffices table has
 * them. */
const POWIAT_OFFICES: RegionOffice[] = [
  {
    teryt: "2215",
    region: "wejherowski",
    name: "Starostwo Powiatowe w Wejherowie",
    regon: "191686414",
    nip: "5881831062",
  },
  {
    teryt: "2215011",
    region: "Reda",
    name: "Urząd Miasta w Redzie",
    regon: "000523583",
    nip: "5881004896",
  },
  {
    teryt: "2215021",
    region: "Rumia",
    name: "Urząd Miasta Rumi",
    regon: "000525257",
    nip: "5861025464",
  },
  {
    teryt: "2215031",
    region: "Wejherowo",
    name: "Urząd Miejski w Wejherowie",
    regon: "000526251",
    nip: "5882155172",
  },
  {
    teryt: "2215042",
    region: "Choczewo",
    name: "Urząd Gminy Choczewo",
    regon: "000534463",
    nip: "5881222222",
  },
  {
    teryt: "2215052",
    region: "Gniewino",
    name: "Urząd Gminy Gniewino",
    regon: "000531720",
    nip: "5881005401",
  },
  {
    teryt: "2215062",
    region: "Linia",
    name: "Urząd Gminy Linia",
    regon: "000537237",
    nip: "5881130342",
  },
  {
    teryt: "2215072",
    region: "Luzino",
    name: "Urząd Gminy Luzino",
    regon: "000539897",
    nip: "5881136020",
  },
  {
    teryt: "2215082",
    region: "Łęczyce",
    name: "Urząd Gminy Łęczyce",
    regon: "000539845",
    nip: "5881155684",
  },
  {
    teryt: "2215092",
    region: "Szemud",
    name: "Urząd Gminy Szemud",
    regon: "000542698",
    nip: "5881150497",
  },
  {
    teryt: "2215102",
    region: "Wejherowo",
    name: "Urząd Gminy Wejherowo",
    regon: "000545113",
    nip: "5881007736",
  },
];

/** What /api/nodes/teryt2215/offices answers, built from those rows with the
 * functions the endpoint uses. None of them has a node on the site, so a place
 * proposed for any of them is seated in the powiat. */
export const powiatOffices: RegionOffices = {
  offices: officeChoices(indexOffices(POWIAT_OFFICES), "2215").map(
    ({ office, gmina }) => ({
      ...office,
      node: null,
      gmina,
      seatId: POWIAT.id,
    }),
  ),
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

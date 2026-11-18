import type { GraphLayout } from "../../../shared/graph/util";
import type { Company, Region } from "../../../shared/model";
import type { RegionRun, RegionRuns } from "../../../shared/electionLists";
import type {
  GovernmentPersonView,
  GovernmentView,
} from "../../../shared/regionAuthorities";
import { graphCompany, graphRegion, layout, relation } from "./entityGraph";

/** Gmina Łowicz as region-page.spec.ts draws it, answered by route handlers:
 * its parents for the breadcrumbs, a company it holds, two elections' lists
 * and its „Władze” - a burmistrz with no page, a council of four committees
 * with one seat nobody is named for. Names made up; the shape of production's
 * on 2026-11-18. */

export const REGION: Region & { id: string } = {
  id: "teryt1005011",
  type: "region",
  name: "Gmina Łowicz",
  teryt: "1005011",
  published: true,
};
const POWIAT: Region & { id: string } = {
  id: "teryt1005",
  type: "region",
  name: "Powiat łowicki",
  teryt: "1005",
  published: true,
};
const WOJEWODZTWO: Region & { id: string } = {
  id: "teryt10",
  type: "region",
  name: "łódzkie",
  teryt: "10",
  published: true,
};
const ZEC: Company & { id: string } = {
  id: "zec-lowicz",
  type: "place",
  name: "ZAKŁAD ENERGETYKI CIEPLNEJ W ŁOWICZU",
  published: true,
};

/** The person a reader arrives from: a run of hers on her page links here. */
export const RADNA = "radna-przykladowa";

function run(
  personId: string,
  personName: string,
  over: Partial<RegionRun> = {},
): RegionRun {
  return {
    edgeId: `${personId}-${over.start ?? "2024"}-${over.position ?? "rada"}`,
    personId,
    personName,
    parties: [],
    published: true,
    start: "2024-01-01",
    position: "Rada miasta",
    committee: "KW PRAWO I SPRAWIEDLIWOŚĆ",
    party: "PiS",
    elected: true,
    byElection: false,
    ...over,
  };
}

const runs: RegionRuns = {
  hidden: 2,
  runs: [
    run(RADNA, "Halina Radna", { parties: ["PiS"] }),
    run(RADNA, "Halina Radna", {
      start: "2018-01-01",
      parties: ["PiS"],
    }),
    run("jan-testowy", "Jan Testowy", { parties: ["PiS"] }),
    run("ewa-szkic", "Ewa Szkic", {
      published: false,
      parties: [],
      partyHidden: true,
    }),
    run("adam-lokalny", "Adam Lokalny", {
      committee: "KWW ŁOWICKIE.PL",
      party: null,
    }),
    run("piotr-przegrany", "Piotr Przegrany", {
      committee: "KWW ŁOWICKIE.PL",
      party: null,
      elected: false,
    }),
    run("maria-ko", "Maria Obywatelska", {
      committee: "KKW KOALICJA OBYWATELSKA",
      party: "PO",
      parties: ["PO"],
      start: "2018-01-01",
    }),
  ],
};

function member(
  name: string,
  committee: string,
  committeeParties: string[] = [],
  page?: GovernmentPersonView["page"],
): GovernmentPersonView {
  return {
    name,
    committee,
    ...(committeeParties.length ? { committeeParties } : {}),
    ...(page ? { page } : {}),
  };
}

const PIS = "KW PRAWO I SPRAWIEDLIWOŚĆ";
const LOWICKIE = "KWW ŁOWICKIE.PL";
const KO = "KKW KOALICJA OBYWATELSKA";
const NASZ = "KWW ŁĄCZY NAS ŁOWICZ I POWIAT ŁOWICKI";

const authorities: GovernmentView = {
  election: "local-2024",
  head: {
    office: "Burmistrz",
    name: "Mariusz Przykładowy",
    committee: LOWICKIE,
  },
  councils: [
    {
      office: "Rada miasta",
      seats: 12,
      members: [
        member("Halina Radna", PIS, ["PiS"], {
          id: RADNA,
          published: true,
          parties: ["PiS"],
        }),
        member("Jan Testowy", PIS, ["PiS"], {
          id: "jan-testowy",
          published: true,
          parties: ["PiS"],
        }),
        member("Ewa Szkic", PIS, ["PiS"], {
          id: "ewa-szkic",
          published: false,
          parties: [],
          partyHidden: true,
        }),
        member("Bogdan Kostrzewski", PIS, ["PiS"]),
        member("Adam Lokalny", LOWICKIE, [], {
          id: "adam-lokalny",
          published: true,
          parties: [],
        }),
        member("Hubert Krajowy", LOWICKIE),
        member("Robert Wiejski", LOWICKIE),
        member("Dorota Chylicka", NASZ),
        member("Szymon Szalony", NASZ),
        member("Krystian Cypryński", NASZ),
        member("Maria Obywatelska", KO, ["PO"], {
          id: "maria-ko",
          published: true,
          parties: ["PO"],
        }),
      ],
    },
  ],
};

export const regionPage = {
  id: REGION.id,
  url: "/region/gmina-lowicz-teryt1005011",
  node: REGION,
  parents: { teryt1005: POWIAT, teryt10: WOJEWODZTWO } as Record<
    string,
    Region & { id: string }
  >,
  graph: layout(
    [graphRegion(REGION), graphRegion(POWIAT), graphCompany(ZEC, 3)],
    [
      relation({
        id: "own-powiat",
        source: POWIAT.id,
        target: REGION.id,
        type: "owns",
      }),
      relation({
        id: "own-zec",
        source: REGION.id,
        target: ZEC.id,
        type: "owns",
      }),
    ],
  ) as GraphLayout,
  runs,
  authorities,
};

import type { GraphLayout } from "../../../shared/graph/util";
import type { Node, NodeStats } from "../../../shared/graph/model";
import { NODE_COLORS } from "../../../shared/graph/nodes";
import type { Person } from "../../../shared/model";

/** A person whose candidacies carry what PKW says beyond the list: a party
 * that backed a run, a party declared beside another party's list, and an
 * association that backed a run. Shaped like Barbara Ewa Kamińska's page,
 * whose 2018 run for mayor of Opole on the KO list PKW records as backed by
 * PSL, and Jacek Orych's, backed by Mareckie Stowarzyszenie Gospodarcze. The
 * name is made up; the places and PKW's wording are real. */

/** The seed's published Jan Kowalski, so the page exists before the route
 * handlers dress it in this career. */
export const STATEMENTS_PERSON = "1";
const NAME = "Barbara Przykładowa";

/** The node as /api/nodes answers it: PSL comes from the backing alone. */
export const statementsNode: { node: Person } = {
  node: {
    id: STATEMENTS_PERSON,
    type: "person",
    name: NAME,
    parties: ["Nowoczesna", "PO", "PSL"],
    published: true,
  } as Person,
};

const stats: NodeStats = { people: 1 };

function region(id: string, name: string): Node & { stats: NodeStats } {
  return {
    id,
    name,
    entityType: "region",
    type: "document",
    color: NODE_COLORS.region,
    visibility: true,
    stats,
  };
}

export function statementsGraph(): GraphLayout {
  const run = (
    id: string,
    target: string,
    day: string,
    fields: Record<string, unknown>,
  ) => ({
    id,
    source: STATEMENTS_PERSON,
    target,
    type: "election" as const,
    name: "kandydatura",
    start_date: day,
    end_date: day,
    visibility: true,
    ...fields,
  });

  return {
    nodes: {
      [STATEMENTS_PERSON]: {
        id: STATEMENTS_PERSON,
        name: NAME,
        entityType: "person",
        type: "circle",
        color: NODE_COLORS.person,
        visibility: true,
        stats,
      },
      teryt1661: region("teryt1661", "Opole"),
      teryt16: region("teryt16", "opolskie"),
      teryt1434: region("teryt1434", "Powiat wołomiński"),
    },
    edges: [
      run("visrunopole2024", "teryt1661", "2024-04-07", {
        position: "Rada miasta",
        party: "PO",
        committee: "KKW KOALICJA OBYWATELSKA",
        elected: true,
      }),
      run("visrunmarki2024", "teryt1434", "2024-04-07", {
        position: "Burmistrz",
        committee: "KWW BURMISTRZA JACKA ORYCHA",
        supported_by:
          "popierany przez organizację: Mareckie Stowarzyszenie Gospodarcze",
      }),
      run("visrunsejm2019", "teryt16", "2019-10-13", {
        position: "Sejm",
        party: "PO",
        committee:
          "KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA PO .N IPL ZIELONI",
        party_member: "członek partii politycznej: Nowoczesna",
        member_parties: ["Nowoczesna"],
      }),
      run("visrunopole2018", "teryt1661", "2018-10-21", {
        position: "Prezydent",
        party: "PO",
        committee:
          "KOALICYJNY KOMITET WYBORCZY PLATFORMA.NOWOCZESNA KOALICJA OBYWATELSKA",
        party_member: "Platforma Obywatelska Rzeczypospolitej Polskiej",
        member_parties: ["PO"],
        supported_by: "Polskie Stronnictwo Ludowe",
        backing_parties: ["PSL"],
      }),
    ],
    nodeGroups: [],
  };
}

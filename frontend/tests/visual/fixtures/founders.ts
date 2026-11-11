import type { GraphLayout } from "../../../shared/graph/util";
import type { Node, NodeStats } from "../../../shared/graph/model";
import { NODE_COLORS } from "../../../shared/graph/nodes";

/** Stand-ins for `/api/graph/local/[id]` with a founder's relation in them,
 * for the capture of how a company page lists one - `CardConnectionList` with
 * a `founderLabel`.
 *
 * WHY A FIXTURE AND NOT THE SEED. A founder's relation is an `owns` edge marked
 * `founder`, which only the company ingest writes, from the pipelines' list of
 * public founders. No seeded edge has it, and giving one to a seeded company
 * would redraw `instytucja-strona` and every other shot of that company for a
 * change none of them is about. A route handler answers this page in this
 * browser context and no other, as in ./draftRelations.ts.
 *
 * WHAT IT IS SHAPED FOR. Both ends of the relation:
 *
 *   - the foundation's page, whose „Właściciele” list its founder beside the
 *     region it is registered in: the founder's row says „Fundator” on a line
 *     of its own, the seat's row nothing;
 *   - the founder's page, whose „Spółki zależne” hold a company it owns and two
 *     bodies it set up: „założona” under a foundation, „założone” under a
 *     sports association, nothing under the company.
 *
 * Long names, so the phone shot shows the name giving way to an ellipsis and
 * the label kept under it.
 */

const stats: NodeStats = { people: 1 };

function place(
  id: string,
  name: string,
  legalForm?: string,
): Node & { stats: NodeStats; legalForm?: string } {
  return {
    id,
    name,
    entityType: "place",
    type: "rect",
    color: NODE_COLORS.place,
    visibility: true,
    stats,
    ...(legalForm ? { legalForm } : {}),
  };
}

function region(id: string, name: string): Node {
  return {
    id,
    name,
    entityType: "region",
    type: "circle",
    color: NODE_COLORS.region,
    visibility: true,
  };
}

const FOUNDER = "visfounderco";
const SEAT = "visfounderseat";

/** The foundation's page: its founder, marked, and its seat. */
export function foundationGraph(subjectId: string): GraphLayout {
  return {
    nodes: {
      [subjectId]: place(subjectId, "Wojewódzki Zakład Testowy", "FUNDACJA"),
      [FOUNDER]: place(
        FOUNDER,
        "AGENCJA ROZWOJU PRZEMYSŁU SPÓŁKA TESTOWA (Warszawa)",
      ),
      [SEAT]: region(SEAT, "Miasto Warszawa"),
    },
    edges: [
      {
        id: "visfounderedge",
        source: FOUNDER,
        target: subjectId,
        type: "owns",
        label: "fundator",
        visibility: true,
        founder: true,
      },
      {
        id: "visfounderseatedge",
        source: SEAT,
        target: subjectId,
        type: "seat",
        label: "siedziba",
        visibility: true,
      },
    ],
  };
}

const OWNED = "visownedco";
const FOUNDATION = "visfoundation";
const CLUB = "visclub";

/** The founder's page: one company it owns and two bodies it set up. */
export function founderGraph(subjectId: string): GraphLayout {
  return {
    nodes: {
      [subjectId]: place(subjectId, "Orlen"),
      [OWNED]: place(OWNED, "SPÓŁKA ZALEŻNA TESTOWA (Płock)"),
      [FOUNDATION]: place(
        FOUNDATION,
        "FUNDACJA TESTOWA IM. BARDZO DŁUGIEGO PATRONA (Warszawa)",
        "FUNDACJA",
      ),
      [CLUB]: place(
        CLUB,
        'MIEJSKI KLUB SPORTOWY "TESTOWY" PŁOCK',
        "STOWARZYSZENIE KULTURY FIZYCZNEJ",
      ),
    },
    edges: [
      {
        id: "visownededge",
        source: subjectId,
        target: OWNED,
        type: "owns",
        label: "właściciel",
        visibility: true,
      },
      {
        id: "visfoundationedge",
        source: subjectId,
        target: FOUNDATION,
        type: "owns",
        label: "fundator",
        visibility: true,
        founder: true,
      },
      {
        id: "visclubedge",
        source: subjectId,
        target: CLUB,
        type: "owns",
        label: "fundator",
        visibility: true,
        founder: true,
      },
    ],
  };
}

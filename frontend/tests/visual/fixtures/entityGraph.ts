import type { GraphLayout } from "../../../shared/graph/util";
import type {
  Edge as GraphEdge,
  Node as GraphNode,
  NodeStats,
} from "../../../shared/graph/model";
import type { Company, Person, Region } from "../../../shared/model";
import type {
  CompanySuccessions,
  PersonSuccession,
  PersonSuccessions,
  Succession,
  SuccessionSide,
} from "../../../server/api/edges/successions.get";
import {
  companyNode,
  personNode,
  regionNode,
} from "../../../shared/graph/nodes";
import { partyColors } from "../../../shared/misc";

/** The pieces ./companyPage.ts and ./personPage.ts build an entity's page
 * from, for company-page.spec.ts and person-page.spec.ts.
 *
 * A page of either kind is drawn from three answers - the node, its local
 * graph and its handovers - and the three have to agree: the board's cards
 * find their rows by edge id, a person's „Wcześniej:” finds its row by the
 * company, the role and the day, and a gap is the days between two dates
 * printed beside it. So each fixture writes its posts down once, as spells,
 * and everything below is derived from them rather than typed out a second
 * time. */

/** Somebody the fixtures name. Made up, every one of them. */
export type Who = { id: string; name: string; parties?: string[] };

/** One post one person held, as the register files it: an employment edge. */
export type Spell = {
  id: string;
  who: Who;
  role: string;
  start?: string;
  end?: string;
};

/** What `page.route` answers for one page - see ../entityPage.ts. */
export type EntityPageFixture = {
  /** The node's id, which every request the page makes is keyed on. No
   * hyphen in it: the page reads the id off the url as whatever follows the
   * last one. */
  id: string;
  /** The url `generateNodeUrl` makes of the node, so the page does not send
   * itself somewhere else on arrival. */
  url: string;
  /** /api/nodes/[id]. */
  node: Person | Company;
  /** /api/graph/local/[id], for the history and the graph alike. */
  graph: GraphLayout;
  /** /api/edges/successions, for a reader who is not signed in and for one
   * who is: names whose pages are drafts are withheld from the first and
   * counted instead (`canName` in the endpoint). */
  successions: {
    reader: CompanySuccessions | PersonSuccessions;
    editor: CompanySuccessions | PersonSuccessions;
  };
};

type LayoutNode = GraphNode & { stats: NodeStats };

/** A person on the canvas, painted by their party the way the server paints
 * them (`personNode`). */
export function graphPerson(who: Who): LayoutNode {
  const person: Person = {
    id: who.id,
    name: who.name,
    type: "person",
    parties: who.parties ?? [],
    published: true,
  };
  return {
    ...personNode(person, partyColors),
    visibility: true,
    stats: { people: 1 },
  };
}

/** A company on the canvas. `people` is what it holds: the canvas leaves a
 * company with nobody in it off, and a list prints the count beside the
 * name. */
export function graphCompany(
  company: Company & { id: string },
  people: number,
): LayoutNode {
  return {
    ...companyNode({ published: true, ...company }),
    visibility: true,
    stats: { people },
  };
}

export function graphRegion(region: Region & { id: string }): LayoutNode {
  return {
    ...regionNode({ published: true, ...region }),
    visibility: true,
    stats: { people: 0 },
  };
}

/** A published relation, the shape the local graph sends. */
export function relation(
  edge: Omit<GraphEdge, "visibility"> & { id: string },
): GraphEdge {
  return { visibility: true, ...edge };
}

/** A spell as the employment edge it is, at `companyId`. */
export function employment(spell: Spell, companyId: string): GraphEdge {
  return relation({
    id: spell.id,
    source: spell.who.id,
    target: companyId,
    type: "employed",
    name: spell.role,
    start_date: spell.start,
    end_date: spell.end,
  });
}

/** The local graph: every node by id, and the relations between them. */
export function layout(nodes: LayoutNode[], edges: GraphEdge[]): GraphLayout {
  return {
    nodes: Object.fromEntries(
      nodes.map((node) => [node.id ?? node.name, node]),
    ),
    edges,
    nodeGroups: [],
  };
}

const MS_PER_DAY = 86_400_000;

/** Days from one register date to the next, as `shared/succession.ts` counts
 * a gap: negative where the second began before the first ended. */
function daysBetween(from: string | undefined, to: string | undefined) {
  if (!from || !to)
    throw new Error(`a handover needs both dates: ${from} ${to}`);
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      MS_PER_DAY,
  );
}

/** One end of a handover, as the endpoint names it. */
function side(spell: Spell): SuccessionSide {
  return {
    edgeId: spell.id,
    personId: spell.who.id,
    personName: spell.who.name,
    parties: spell.who.parties ?? [],
    start: spell.start ?? null,
    end: spell.end ?? null,
    published: true,
  };
}

/** /api/edges/successions?companyId= for a company whose handovers are
 * `pairs` - who left, who took the seat - and whose board today is `current`.
 * The pairs are the ones `successionsAtCompany` makes of the same spells:
 * closest first, one to one. Each is in the same seat on both sides, and a
 * day on which several seats of one role changed hands is a batch. */
export function companySuccessions(
  company: { id: string; name: string },
  pairs: [left: Spell, joined: Spell][],
  current: Spell[],
  hidden = 0,
): CompanySuccessions {
  const successions: Succession[] = pairs.map(([left, joined]) => ({
    companyId: company.id,
    companyName: company.name,
    role: joined.role,
    date: joined.start ?? null,
    gapDays: daysBetween(left.end, joined.start),
    batchSize: pairs.filter(
      ([, other]) => other.start === joined.start && other.role === joined.role,
    ).length,
    left: side(left),
    joined: side(joined),
  }));
  return {
    successions,
    current: current.map((spell) => ({
      edgeId: spell.id,
      personId: spell.who.id,
      personName: spell.who.name,
      parties: spell.who.parties ?? [],
      role: spell.role,
      start: spell.start ?? null,
    })),
    hidden,
  };
}

/** One of a person's posts at `company` with the person who held the seat
 * before them (`predecessor`) or after them (`successor`). `batchSize` says
 * how many seats of that role changed hands that day. */
export function personPost(
  company: { id: string; name: string },
  mine: Spell,
  neighbour: { predecessor: Spell } | { successor: Spell },
  batchSize = 1,
): PersonSuccession {
  const before = "predecessor" in neighbour ? neighbour.predecessor : null;
  const after = "successor" in neighbour ? neighbour.successor : null;
  return {
    companyId: company.id,
    companyName: company.name,
    role: mine.role,
    start: mine.start ?? null,
    end: mine.end ?? null,
    predecessor: before
      ? { ...side(before), gapDays: daysBetween(before.end, mine.start) }
      : null,
    successor: after
      ? { ...side(after), gapDays: daysBetween(mine.end, after.start) }
      : null,
    batchSize,
  };
}

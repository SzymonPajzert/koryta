import type { Edge, Node } from "./model";
import type { GraphLayout } from "./util";

/** A group this size is not an electoral list.
 *
 * A candidacy names the committee it stood for, and a committee registers one
 * list per district per contest, so a group here should be at most the number
 * of seats a district has - a couple of dozen for a Sejm district, fewer for a
 * gmina council. Well past that, the committee string has been written loosely
 * enough to cover several lists at once (a bare "KWW", a party name with no
 * committee suffix), and every pair it would produce is a guess. Drop the whole
 * group rather than draw a hairball of them.
 */
export const MAX_LIST_MEMBERS = 40;

/** How many derived edges one layout may carry.
 *
 * A region page draws everyone who ever stood there, which is 142 people and
 * 379 candidacies for the largest gmina we hold. Split into real lists that is
 * still several hundred pairs, and the force layout in the browser has to
 * settle all of them. The cap is a render guard, not a claim about the data:
 * groups are taken smallest first, so the small lists - two or three people on
 * the page out of one committee, which is the informative case - always survive
 * it, and what is dropped is the near-complete list whose members are already
 * visibly clustered around their region.
 */
export const MAX_CO_CANDIDATE_EDGES = 300;

/** One shared list, as it will be read back to a human. */
interface SharedList {
  committee: string;
  year: string;
}

function isPerson(node: Node | undefined): boolean {
  if (!node) return false;
  // `entityType` carries the database type through `getNodesNoStats`; `type` is
  // the shape it is drawn as, and is the only one a hand-built node in a test
  // is guaranteed to have.
  return node.entityType
    ? node.entityType === "person"
    : node.type === "circle";
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/** Two committee names that differ only in spacing or case are one committee.
 *
 * Nothing stronger than that: "KW Prawo i Sprawiedliwość" and "KKW Prawo i
 * Sprawiedliwość" are different registrations and stay apart, because deciding
 * they are the same committee is a judgement about Polish electoral law rather
 * than about strings.
 */
function normaliseCommittee(committee: string): string {
  return committee.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");
}

/** The candidacy an `election` edge records, or nothing if it cannot say which
 * list that candidacy stood on.
 *
 * Every one of the 10,476 stored candidacies is currently in the second case:
 * the committee has never reached Firestore, and until a re-ingest fills it in
 * this function returns nothing for all of them. That is deliberate. District
 * and year alone would put two people on "the same list" who in fact ran
 * against each other, which is a stronger claim than the data supports and the
 * wrong one to make on a page about them.
 */
function candidacy(
  edge: Edge,
  nodes: Record<string, Node>,
): { personId: string; key: string; list: SharedList } | undefined {
  if (edge.type !== "election") return undefined;

  const committee = edge.committee?.trim();
  if (!committee) return undefined;

  const year = edge.start_date?.slice(0, 4);
  if (!year || !/^\d{4}$/.test(year)) return undefined;

  // Stored candidacies always run person -> region, but read the ends off the
  // nodes rather than trusting that: an edge drawn the other way round would
  // otherwise key its group on a person and pair up regions.
  const sourceIsPerson = isPerson(nodes[edge.source]);
  const targetIsPerson = isPerson(nodes[edge.target]);
  if (sourceIsPerson === targetIsPerson) return undefined;

  const personId = sourceIsPerson ? edge.source : edge.target;
  const districtId = sourceIsPerson ? edge.target : edge.source;

  return {
    personId,
    // The district is part of the list: a committee registers a separate list
    // in every place it stands, and standing for the same party in two gminas
    // is not standing together. So is the position - a committee's candidate
    // for wójt is not on its council list.
    key: [
      normaliseCommittee(committee),
      districtId,
      year,
      edge.position ?? "",
    ].join(" "),
    list: { committee, year },
  };
}

/** Edges between people the graph already draws who stood on the same list.
 *
 * An `election` edge only ever joins a person to a district, so two people who
 * ran together appear as two spokes off the same region node - true, and
 * invisible next to every other candidacy that region has ever had. This draws
 * the fact as what it is: a line between the two of them.
 *
 * Nothing is fetched. A pair is drawn only when both people are already on the
 * page, which is what keeps a district from becoming a clique of everyone who
 * ever stood in it: on a person's own graph at distance 1 their co-candidates
 * are two hops away and so no line is drawn, while a region page has all of
 * them and draws the lists among them.
 *
 * A pair that already has an edge between it is left alone. The graph shows
 * them as connected either way, and a recorded relation - somebody saying these
 * two are linked - should not be doubled by an inference.
 */
export function coCandidateEdges(
  edges: Edge[],
  nodes: Record<string, Node>,
): Edge[] {
  const groups = new Map<string, Map<string, SharedList>>();
  const alreadyJoined = new Set<string>();

  for (const edge of edges) {
    if (edge.source !== edge.target) {
      alreadyJoined.add(pairKey(edge.source, edge.target));
    }

    const found = candidacy(edge, nodes);
    if (!found) continue;

    let group = groups.get(found.key);
    if (!group) {
      group = new Map<string, SharedList>();
      groups.set(found.key, group);
    }
    // The same person on the same list twice - a duplicated candidacy - is one
    // member, not two, and must not end up paired with themselves.
    group.set(found.personId, found.list);
  }

  const drawable = [...groups.entries()]
    .filter(([, group]) => group.size >= 2 && group.size <= MAX_LIST_MEMBERS)
    // Smallest first, then by key, so that the same graph always yields the
    // same edges once `MAX_CO_CANDIDATE_EDGES` starts dropping them.
    .sort(([keyA, a], [keyB, b]) =>
      a.size !== b.size ? a.size - b.size : keyA.localeCompare(keyB),
    );

  const pairs = new Map<
    string,
    { a: string; b: string; lists: SharedList[] }
  >();
  for (const [, group] of drawable) {
    const members = [...group.keys()].sort();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!;
        const b = members[j]!;
        const key = pairKey(a, b);
        if (alreadyJoined.has(key)) continue;

        const existing = pairs.get(key);
        if (existing) {
          existing.lists.push(group.get(a)!);
        } else if (pairs.size < MAX_CO_CANDIDATE_EDGES) {
          pairs.set(key, { a, b, lists: [group.get(a)!] });
        }
      }
    }
  }

  return [...pairs.values()].map(({ a, b, lists }) => {
    const sorted = [...lists].sort((x, y) => y.year.localeCompare(x.year));
    const summary = sorted
      .map((list) => `${list.committee} (${list.year})`)
      .join("; ");
    const one = sorted.length === 1;

    const derived: Edge = {
      // Deliberately not shaped like a Firestore id, so that anything trying to
      // use it as one fails loudly rather than editing some other edge.
      id: `co-candidate:${a}:${b}`,
      source: a,
      target: b,
      type: "co_candidate",
      label: one
        ? `wspólna lista ${sorted[0]!.year}`
        : `wspólne listy (${sorted.length})`,
      name: one ? "wspólna lista" : "wspólne listy wyborcze",
      content: one
        ? `Wspólna lista wyborcza: ${summary}`
        : `Wspólne listy wyborcze: ${summary}`,
      // Both ends are already on a graph the reader is allowed to see, so this
      // says nothing their two candidacies did not already say.
      visibility: true,
      // No traverse policy at all, which is the one setting `getNodeGroups`
      // ignores outright - it skips an edge with no `traverse` before looking
      // at anything else. `dead_end` would not do: it only stops the walk
      // *past* the far end, so the far end itself still joins the group, and
      // everyone who ever shared a list would count towards the people totals
      // on region and company nodes. `withCoCandidates` runs after the groups
      // are built anyway; this is what makes that ordering not load-bearing.
    };
    if (one) derived.committee = sorted[0]!.committee;
    return derived;
  });
}

/** The same layout with the shared lists among its people drawn in.
 *
 * Applied after `getNodeGroups`, so the derived edges change nothing about
 * which nodes count as connected or how many people a place is credited with.
 * They are something to look at, not evidence.
 */
export function withCoCandidates(layout: GraphLayout): GraphLayout {
  const derived = coCandidateEdges(layout.edges, layout.nodes);
  if (derived.length === 0) return layout;
  return { ...layout, edges: [...layout.edges, ...derived] };
}

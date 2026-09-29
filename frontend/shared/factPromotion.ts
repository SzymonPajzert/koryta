/** How an extracted fact becomes a relation in the graph.
 *
 * Shared by the card that offers „Utwórz powiązanie” and by /api/edges/create,
 * which refuses a promotion the rule does not allow - so the two cannot drift
 * into a button the endpoint accepts anything behind.
 */
import type { ExtractionFact, ExtractionFactType, NodeType } from "./model";

/** How an extracted fact becomes an edge, where it can.
 *
 * `targetType` is what the reader has to pick, because only the person side of
 * a fact is ever resolved: `ingest/extraction.post.ts` matches the subject
 * against the article's confirmed `koryta_ids`, and leaves `organization`,
 * `party`, `object` and `affair` as the strings the article used. Nothing in the
 * app resolves those to a node, so the far end is a question rather than a
 * lookup - and the answer is a judgement anyway, since two companies share a
 * name as readily as two people do.
 */
export type FactEdgeRule = {
  edgeType: "employed" | "connection";
  targetType: NodeType;
  /** What goes in the edge's `name`, off the fact. */
  label: (fact: ExtractionFact) => string;
  /** What to call the far end while it is being picked. */
  targetLabel: string;
};

/** The two fact types that have an edge type to become.
 *
 * The other two have nowhere to go, and saying so is the honest answer rather
 * than an oversight:
 *
 * - `party_membership` has no party node. A person's parties are a `parties`
 *   array on the node itself (see `Person`), so recording one is an edit to
 *   that person rather than a relation, and it belongs to whatever eventually
 *   proposes node revisions from facts.
 * - `affair_involvement` would be person -> topic, and `tagged` - the only edge
 *   type a topic is declared for - is article -> topic. Widening it is a model
 *   change with its own consequences for the graph, where `tagged` is a
 *   dead end in both directions specifically so a topic does not become a hub.
 */
const FACT_EDGE_RULES: Partial<Record<ExtractionFactType, FactEdgeRule>> = {
  employment: {
    edgeType: "employed",
    targetType: "place",
    label: (fact) => fact.role ?? "",
    targetLabel: "Pracodawca",
  },
  personal_relation: {
    edgeType: "connection",
    targetType: "person",
    label: (fact) => fact.relation ?? "",
    targetLabel: "Druga osoba",
  },
};

/** How this fact would become an edge, or undefined where it cannot.
 *
 * Undefined for a fact whose subject was never matched to anybody, as well as
 * for a type with no edge: without a person node there is no end of the relation
 * we are sure of, and asking a reader to pick both ends is the generic edge
 * form rather than a promotion.
 */
export function factEdgeRule(fact: ExtractionFact): FactEdgeRule | undefined {
  if (!fact.personNodeId) return undefined;
  return FACT_EDGE_RULES[fact.fact_type];
}

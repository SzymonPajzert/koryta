import type {
  ExtractionFact,
  ExtractionFactType,
  NodeType,
} from "~~/shared/model";

/** Exported so a filter can label the *types* rather than a fact: the chip row
 * on a person's page names every kind of fact that person has, and there is no
 * fact to hand it. `factTypeLabel` below stays the way a card asks. */
export const FACT_TYPE_LABELS: Record<ExtractionFactType, string> = {
  employment: "Zatrudnienie",
  party_membership: "Członkostwo partyjne",
  personal_relation: "Relacja osobista",
  affair_involvement: "Rola w aferze",
};

export const FACT_TYPE_COLORS: Record<ExtractionFactType, string> = {
  employment: "primary",
  party_membership: "secondary",
  personal_relation: "info",
  affair_involvement: "warning",
};

/** Human-readable label for a fact's type (falls back to the raw type). */
export function factTypeLabel(fact: ExtractionFact): string {
  return FACT_TYPE_LABELS[fact.fact_type];
}

/** Vuetify color token for a fact's type. */
export function factTypeColor(fact: ExtractionFact): string {
  return FACT_TYPE_COLORS[fact.fact_type];
}

// --- Edge-style presentation ---
// A fact reads as an edge: source ── connector ──▶ target.

/** Left-hand entity: the person the fact is about (person / relation subject). */
export function factSubject(fact: ExtractionFact): string {
  return fact.person || fact.subject || "—";
}

/** Right-hand entity: organization / party / related person / affair. */
export function factTarget(fact: ExtractionFact): string | undefined {
  if (fact.fact_type === "employment") return fact.organization;
  if (fact.fact_type === "party_membership") return fact.party;
  if (fact.fact_type === "affair_involvement") return fact.affair;
  return fact.object; // personal_relation
}

/** Connector label shown on the arrow between the two entities. */
export function factConnector(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return fact.role || "zatrudnienie";
  if (fact.fact_type === "party_membership") return "członek";
  if (fact.fact_type === "affair_involvement")
    return fact.role || "rola w aferze";
  return fact.relation || "relacja"; // personal_relation
}

/** Kind caption under the right-hand entity ("" when its type is unknown). */
export function factTargetKind(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return "organizacja";
  if (fact.fact_type === "party_membership") return "partia";
  if (fact.fact_type === "affair_involvement") return "afera";
  return ""; // personal_relation: the object's type is not asserted
}

// --- Promotion to a relation in the graph ---

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

/** Why a fact cannot be promoted, in the reader's words. Empty when it can. */
export function factPromotionBlocker(fact: ExtractionFact): string {
  if (factEdgeRule(fact)) return "";
  if (!fact.personNodeId) {
    return "Nie wiemy, której osoby w bazie dotyczy ten fakt.";
  }
  if (fact.fact_type === "party_membership") {
    return "Członkostwo partyjne zapisujemy przy osobie, a nie jako powiązanie.";
  }
  return "Dla tego rodzaju faktu nie mamy jeszcze typu powiązania.";
}

// --- What readers have made of a fact ---

/** The three things a reader can say about a fact.
 *
 * „poprawny" and „niepoprawny" are two ends of one vote category; „za mało
 * informacji" is its own, because a reviewer who cannot decide has not thereby
 * said the fact is wrong. Every surface that judges a fact - the review queue,
 * the swipe deck and a person's page - offers exactly these three. */
export type FactVerdict = "correct" | "incorrect" | "insufficient";

/** Where a fact stands with the people who have looked at it. */
export type FactReviewState = "confirmed" | "disputed" | "unreviewed";

/** Read off the aggregate the fact document already carries, which is the
 * whole point: `useVotes` opens a Firestore listener per card, and a person's
 * page mounts every card at once. `Card.vue`'s `reportedWrongPerson` follows
 * the same rule.
 *
 * `correct` is a *sum* of human verdicts (see `computeVoteStats`), so a
 * negative one is a fact readers rejected rather than one nobody has read. Two
 * readers who disagree cancel out to 0 and land back in `unreviewed`, which is
 * the honest answer: the aggregate cannot say more than that people looked and
 * did not settle it.
 */
export function factReviewState(fact: ExtractionFact): FactReviewState {
  const votes = fact.stats?.votes as Record<string, unknown> | undefined;
  const correct = numeric(votes?.correct);
  if (correct < 0 || numeric(votes?.wrongPerson) > 0) return "disputed";
  if (correct > 0) return "confirmed";
  return "unreviewed";
}

/** How many people have voted on this fact.
 *
 * `humanCount` is absent on every aggregate written before the field existed,
 * and `scripts/migrate/backfill-vote-human-count.ts` covered nodes only - so
 * `humanVoted` is the fallback, and one voter is a better answer than none for
 * a fact somebody demonstrably judged.
 */
export function factVoterCount(fact: ExtractionFact): number {
  const votes = fact.stats?.votes;
  const count = votes?.humanCount;
  if (typeof count === "number" && count > 0) return count;
  return votes?.humanVoted ? 1 : 0;
}

/** A vote category is only written once somebody has voted in it, so every
 * read of the aggregate has to survive the field being absent. */
function numeric(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

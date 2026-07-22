import type { ExtractionFact, ExtractionFactType } from "~~/shared/model";

const FACT_TYPE_LABELS: Record<ExtractionFactType, string> = {
  employment: "Zatrudnienie",
  party_membership: "Członkostwo partyjne",
  personal_relation: "Relacja osobista",
};

const FACT_TYPE_COLORS: Record<ExtractionFactType, string> = {
  employment: "primary",
  party_membership: "secondary",
  personal_relation: "info",
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

/** Right-hand entity: organization / party / related person. */
export function factTarget(fact: ExtractionFact): string | undefined {
  if (fact.fact_type === "employment") return fact.organization;
  if (fact.fact_type === "party_membership") return fact.party;
  return fact.object; // personal_relation
}

/** Connector label shown on the arrow between the two entities. */
export function factConnector(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return fact.role || "zatrudnienie";
  if (fact.fact_type === "party_membership") return "członek";
  return fact.relation || "relacja"; // personal_relation
}

/** Kind caption under the right-hand entity ("" when its type is unknown). */
export function factTargetKind(fact: ExtractionFact): string {
  if (fact.fact_type === "employment") return "organizacja";
  if (fact.fact_type === "party_membership") return "partia";
  return ""; // personal_relation: the object's type is not asserted
}

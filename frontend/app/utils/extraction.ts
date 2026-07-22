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

/** The person the fact is about (person, or the subject of a relation). */
export function factSubject(fact: ExtractionFact): string {
  return fact.person || fact.subject || "—";
}

/** Short summary of the fact's payload, varying by fact type. */
export function factSummary(fact: ExtractionFact): string | null | undefined {
  if (fact.fact_type === "employment") return fact.organization;
  if (fact.fact_type === "party_membership") return fact.party;
  // personal_relation (the remaining fact_type)
  return fact.object
    ? `${fact.relation ?? "relacja"} → ${fact.object}`
    : fact.relation;
}

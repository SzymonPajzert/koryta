import { describe, it, expect } from "vitest";
import type { ExtractionFact } from "~~/shared/model";
import { factEdgeRule, factPromotionBlocker } from "~/utils/extraction";

const fact = (overrides: Partial<ExtractionFact> = {}): ExtractionFact => ({
  url: "https://example.pl/a",
  justification: "Tak pisze gazeta",
  fact_type: "employment",
  articleUrl: "https://example.pl/a",
  tag: "v1",
  person: "Anna Nowak",
  organization: "Spółka",
  role: "prezes zarządu",
  personNodeId: "person-1",
  personNodeName: "Anna Nowak",
  ...overrides,
});

describe("factEdgeRule", () => {
  it("turns an employment into an employed edge, keeping the role", () => {
    const rule = factEdgeRule(fact())!;
    expect(rule.edgeType).toBe("employed");
    expect(rule.targetType).toBe("place");
    expect(rule.label(fact())).toBe("prezes zarządu");
  });

  it("turns a personal relation into a connection between two people", () => {
    const relation = fact({
      fact_type: "personal_relation",
      subject: "Anna Nowak",
      object: "Bogdan Zyx",
      relation: "brat",
    });
    const rule = factEdgeRule(relation)!;
    expect(rule.edgeType).toBe("connection");
    expect(rule.targetType).toBe("person");
    expect(rule.label(relation)).toBe("brat");
  });

  it("refuses a fact nobody in the graph was matched to", () => {
    // Without a person node there is no end of the relation we are sure of,
    // and asking for both ends is the generic edge form, not a promotion.
    expect(factEdgeRule(fact({ personNodeId: undefined }))).toBeUndefined();
    expect(factPromotionBlocker(fact({ personNodeId: undefined }))).toContain(
      "której osoby",
    );
  });

  it("refuses the two fact types with no edge type to become", () => {
    // A party is not a node, and person -> topic is not a declared relation.
    for (const fact_type of [
      "party_membership",
      "affair_involvement",
    ] as const) {
      expect(factEdgeRule(fact({ fact_type }))).toBeUndefined();
      expect(factPromotionBlocker(fact({ fact_type }))).not.toBe("");
    }
  });

  it("says nothing is wrong with a fact that can be promoted", () => {
    expect(factPromotionBlocker(fact())).toBe("");
  });

  it("copes with an employment the model gave no role for", () => {
    expect(
      factEdgeRule(fact({ role: undefined }))!.label(fact({ role: undefined })),
    ).toBe("");
  });
});

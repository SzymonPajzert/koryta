import { describe, it, expect } from "vitest";
import {
  relationChoices,
  edgeTypeOptions,
  officeChoice,
} from "../../app/composables/useEdgeTypes";

/** Just the verbs, which is what the composer actually renders. */
const verbs = (...args: Parameters<typeof relationChoices>) =>
  relationChoices(...args).map((choice) => choice.verb);

describe("relationChoices", () => {
  it("offers employment between a person and a company", () => {
    expect(verbs("person", "place")).toContain("pracował/a w");
  });

  it("reads the same relation the other way round from the company's page", () => {
    // Direction never reaches the reader: the page is always the subject, and
    // the verb is what changes.
    expect(verbs("place", "person")).toContain("zatrudniał/a");
    expect(verbs("place", "person")).not.toContain("pracował/a w");
  });

  it("offers a plain connection between two people, and not employment", () => {
    const between = verbs("person", "person");
    expect(between).toContain("jest powiązany/a z");
    expect(between).not.toContain("pracował/a w");
  });

  it("offers candidacy between a person and a region", () => {
    expect(verbs("person", "region")).toContain("kandydował/a w");
  });

  it("offers nothing between two regions", () => {
    // The composer shows its empty state rather than a list of impossible
    // relations, which is the whole reason the entity is picked first.
    expect(relationChoices("region", "region")).toEqual([]);
  });

  it("narrows to what the section that opened it is about", () => {
    // "Spółki zależne" asks only about ownership, so its dialog must not offer
    // to record employment as well.
    const owning = relationChoices("place", "place", ["owns_child"]);
    expect(owning.map((c) => c.verb)).toEqual(["jest właścicielem"]);
  });

  it("does not offer the same sentence twice for one stored type", () => {
    // `owns` is stored once but modelled as owns_parent and owns_child, which
    // for a place-to-place pair describe the same two readings twice over.
    const all = relationChoices("place", "place");
    expect(new Set(all.map((c) => c.verb)).size).toBe(all.length);
  });

  it("resolves each choice back to a stored edge type", () => {
    for (const nodeType of ["person", "place", "region"] as const) {
      for (const other of ["person", "place", "region"] as const) {
        for (const choice of relationChoices(nodeType, other)) {
          expect(edgeTypeOptions[choice.edgeTypeExt].realType).toBeTruthy();
        }
      }
    }
  });

  it("respects a relation that only goes one way", () => {
    // owns_child is outgoing-only; a place must not be offered it as the
    // subsidiary end, which is what owns_parent is for.
    const choices = relationChoices("place", "place", ["owns_child"]);
    expect(choices.every((c) => c.direction === "outgoing")).toBe(true);
  });

  it("gives every offered choice a verb to render", () => {
    for (const nodeType of ["person", "place", "region", "article"] as const) {
      for (const other of ["person", "place", "region", "article"] as const) {
        for (const choice of relationChoices(nodeType, other)) {
          expect(choice.verb.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("officeChoice", () => {
  it("offers a post in the urząd between a person and a region", () => {
    expect(officeChoice("person", "region")).toMatchObject({
      edgeTypeExt: "employed",
      direction: "outgoing",
      viaOffice: true,
    });
  });

  it("is never among the relations a pair can have directly", () => {
    // What it stores is a job at a place the region only points to. Offered by
    // `relationChoices`, the article dialog would take it at face value and
    // store the gmina as the employer.
    for (const nodeType of ["person", "place", "region", "article"] as const) {
      for (const other of ["person", "place", "region", "article"] as const) {
        expect(
          relationChoices(nodeType, other).some((choice) => choice.viaOffice),
        ).toBe(false);
      }
    }
  });

  it("is only for a person and a region", () => {
    expect(officeChoice("region", "person")).toBeUndefined();
    expect(officeChoice("person", "place")).toBeUndefined();
  });

  it("follows the section's narrowing, as employment", () => {
    expect(officeChoice("person", "region", ["election"])).toBeUndefined();
    expect(officeChoice("person", "region", ["employed"])).toBeDefined();
  });
});

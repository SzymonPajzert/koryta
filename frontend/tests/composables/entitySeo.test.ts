import { describe, it, expect } from "vitest";
import {
  entityDescription,
  entityOgType,
  truncateDescription,
  type EntityNode,
} from "../../app/composables/entitySeo";

function node(fields: Record<string, unknown>): EntityNode {
  return fields as unknown as EntityNode;
}

describe("truncateDescription", () => {
  it("leaves a description that already fits alone", () => {
    expect(truncateDescription("Krótki opis", 40)).toBe("Krótki opis");
  });

  it("cuts on a word boundary and marks the cut", () => {
    expect(truncateDescription("jeden dwa trzy cztery", 16)).toBe(
      "jeden dwa trzy…",
    );
  });

  it("cuts mid-word rather than return almost nothing", () => {
    // An article headline can be one unbroken token; falling back to the last
    // space would leave an empty string.
    expect(truncateDescription("aaaaaaaaaaaaaaaaaaaa b", 10)).toBe(
      "aaaaaaaaa…",
    );
  });

  it("does not leave punctuation stranded before the ellipsis", () => {
    expect(truncateDescription("jeden dwa, trzy cztery", 15)).toBe(
      "jeden dwa…",
    );
  });
});

describe("entityDescription", () => {
  it("counts a person's relations, and declines the count", () => {
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 2),
    ).toContain("2 powiązania");
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 5),
    ).toContain("5 powiązań");
    expect(
      entityDescription(node({ type: "person", name: "Jan Kowalski" }), 1),
    ).toContain("1 powiązanie");
  });

  it("names the person's parties when it knows them", () => {
    const text = entityDescription(
      node({ type: "person", name: "Jan Kowalski", parties: ["PSL", "PiS"] }),
      3,
    );
    expect(text).toContain("Jan Kowalski (PSL, PiS)");
  });

  /** „Inne” says there is a political tie and not whose - in a search result
   * „(Inne)” reads as a typo, so it is named on the page and not here. */
  it("leaves „Inne” out of the parties it names", () => {
    expect(
      entityDescription(
        node({
          type: "person",
          name: "Jan Kowalski",
          parties: ["Inne", "PiS"],
        }),
        3,
      ),
    ).toContain("Jan Kowalski (PiS) w bazie");
    expect(
      entityDescription(
        node({ type: "person", name: "Jan Kowalski", parties: ["Inne"] }),
        3,
      ),
    ).toContain("Jan Kowalski w bazie");
  });

  it("promises nothing about a page with no relations yet", () => {
    const text = entityDescription(
      node({ type: "person", name: "Jan Kowalski" }),
      0,
    );
    expect(text).not.toContain("0");
    expect(text).toContain("Jan Kowalski");
  });

  it("asks the question a company page answers", () => {
    expect(
      entityDescription(node({ type: "place", name: "Orlen S.A." }), 12),
    ).toContain("Kto pracuje i pracował w Orlen S.A.?");
  });

  it("describes a region by its name", () => {
    expect(
      entityDescription(node({ type: "region", name: "Kraków" }), 0),
    ).toContain("Kraków");
  });

  it("does not repeat the headline an article page already titles itself", () => {
    const headline = "Zarzuty wobec byłego dyrektora generalnego";
    expect(
      entityDescription(node({ type: "article", name: headline }), 4),
    ).not.toContain(headline);
  });

  it("stays inside what a link preview will show", () => {
    const longName = "Wojewódzki ".repeat(30);
    for (const type of ["person", "place", "region", "article"] as const) {
      const text = entityDescription(node({ type, name: longName }), 7);
      expect(text.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("entityOgType", () => {
  it("files each kind of page as what it is", () => {
    expect(entityOgType(node({ type: "article", name: "x" }))).toBe("article");
    expect(entityOgType(node({ type: "person", name: "x" }))).toBe("profile");
    expect(entityOgType(node({ type: "place", name: "x" }))).toBe("website");
    expect(entityOgType(node({ type: "region", name: "x" }))).toBe("website");
  });
});

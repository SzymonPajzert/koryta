import { describe, it, expect } from "vitest";
import {
  isSymmetricRelation,
  normalizeRelationName,
  relationNeedsReverse,
  reverseRelationSuggestions,
} from "../../shared/relations";

describe("reverseRelationSuggestions", () => {
  it("answers a marriage with one word", () => {
    expect(reverseRelationSuggestions("żona")).toEqual(["mąż"]);
    expect(reverseRelationSuggestions("mąż")).toEqual(["żona"]);
  });

  it("offers both readings where the relation cannot choose", () => {
    // The edge says somebody is a father; nothing on it says whether the child
    // is a son or a daughter, so both are offered and a human picks.
    expect(reverseRelationSuggestions("ojciec")).toEqual(["syn", "córka"]);
    expect(reverseRelationSuggestions("babcia")).toEqual(["wnuk", "wnuczka"]);
  });

  it("puts the word itself first where the tie is symmetric", () => {
    expect(reverseRelationSuggestions("wspólnik")[0]).toBe("wspólnik");
    expect(reverseRelationSuggestions("brat")).toEqual(["brat", "siostra"]);
  });

  it("ignores case and stray whitespace", () => {
    expect(reverseRelationSuggestions("  ŻONA ")).toEqual(["mąż"]);
  });

  it("carries a modifier across, in the gender the reversed word wants", () => {
    // "były mąż" reversed is "była żona", not "były żona" - and dropping the
    // modifier altogether would turn a divorce back into a marriage.
    expect(reverseRelationSuggestions("była żona")).toEqual(["były mąż"]);
    expect(reverseRelationSuggestions("były mąż")).toEqual(["była żona"]);
    expect(reverseRelationSuggestions("były wspólnik")).toEqual([
      "były wspólnik",
      "była wspólniczka",
    ]);
  });

  it("says nothing about a word it has never seen", () => {
    // Silence is the honest answer: "szara eminencja" has no reverse anybody
    // could derive, and a wrong guess is worse than no guess.
    expect(reverseRelationSuggestions("szara eminencja")).toEqual([]);
    expect(reverseRelationSuggestions("")).toEqual([]);
    expect(reverseRelationSuggestions(undefined)).toEqual([]);
  });
});

describe("isSymmetricRelation", () => {
  it("is true only where the best guess is the word itself", () => {
    expect(isSymmetricRelation("wspólnik")).toBe(true);
    expect(isSymmetricRelation("brat")).toBe(true);
    expect(isSymmetricRelation("była wspólniczka")).toBe(true);
  });

  it("is false for a tie that reads differently each way", () => {
    expect(isSymmetricRelation("ojciec")).toBe(false);
    expect(isSymmetricRelation("żona")).toBe(false);
  });

  it("is false for a word with no reverse at all", () => {
    expect(isSymmetricRelation("szara eminencja")).toBe(false);
  });
});

describe("relationNeedsReverse", () => {
  it("is true for a named connection with only one side", () => {
    expect(relationNeedsReverse({ type: "connection", name: "żona" })).toBe(
      true,
    );
  });

  it("is false once both sides are stored", () => {
    expect(
      relationNeedsReverse({
        type: "connection",
        name: "żona",
        reverse_name: "mąż",
      }),
    ).toBe(false);
  });

  it("is false for a connection nobody named", () => {
    // It falls back to "Powiązanie z" on both pages, which is already the same
    // claim from either end.
    expect(relationNeedsReverse({ type: "connection", name: "" })).toBe(false);
    expect(relationNeedsReverse({ type: "connection", name: "   " })).toBe(
      false,
    );
  });

  it("is false for every other edge type", () => {
    // An employment prints the job title whichever page it is read from, and
    // its two phrasings come off the type rather than off the document.
    expect(
      relationNeedsReverse({ type: "employed", name: "prezes zarządu" }),
    ).toBe(false);
    expect(relationNeedsReverse({ type: "election", name: "Sejm" })).toBe(
      false,
    );
  });
});

describe("normalizeRelationName", () => {
  it("folds case and collapses whitespace", () => {
    expect(normalizeRelationName("  Była   Żona ")).toBe("była żona");
  });

  it("reads an absent name as empty", () => {
    expect(normalizeRelationName(undefined)).toBe("");
    expect(normalizeRelationName(null)).toBe("");
  });
});

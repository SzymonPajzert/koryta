import { describe, it, expect } from "vitest";
import { nbsp } from "~/utils/nbsp";

/** A non-breaking space, spelled out so the expectations can be read. */
const NB = " ";

describe("nbsp", () => {
  it("ties each one-letter word to the word after it", () => {
    expect(nbsp("Pracował w Orlenie i w PKP.")).toBe(
      `Pracował w${NB}Orlenie i${NB}w${NB}PKP.`,
    );
  });

  it("knows the six letters a Polish line may not end on, in either case", () => {
    for (const letter of ["a", "i", "o", "u", "w", "z"]) {
      expect(nbsp(`x ${letter} y`)).toBe(`x ${letter}${NB}y`);
      const upper = letter.toUpperCase();
      expect(nbsp(`${upper} y`)).toBe(`${upper}${NB}y`);
    }
  });

  it("leaves other one-letter words alone", () => {
    expect(nbsp("punkt e i k")).toBe(`punkt e i${NB}k`);
  });

  it("leaves those letters alone at the end of a longer word", () => {
    // „bez sensu” ends in „z”, and „Kowalska ma” in „a”: neither is a word.
    expect(nbsp("bez sensu")).toBe("bez sensu");
    expect(nbsp("Kowalska ma")).toBe("Kowalska ma");
  });

  it("reads a word at the start, after a bracket and after a quote", () => {
    expect(nbsp("W 2019 r. został prezesem")).toBe(
      `W${NB}2019 r. został prezesem`,
    );
    expect(nbsp("(w latach 2015-2019)")).toBe(`(w${NB}latach 2015-2019)`);
    expect(nbsp("„o tym nie mówiono”")).toBe(`„o${NB}tym nie mówiono”`);
    expect(nbsp('"z urzędu"')).toBe(`"z${NB}urzędu"`);
  });

  it("only joins a word to a word: never to the end of the text or another space", () => {
    expect(nbsp("prezes i")).toBe("prezes i");
    expect(nbsp("prezes i  członek")).toBe("prezes i  członek");
  });

  it("changes nothing that has no one-letter word in it", () => {
    const text = "Prezes zarządu spółki od 2016 roku.";
    expect(nbsp(text)).toBe(text);
    expect(nbsp("")).toBe("");
  });
});

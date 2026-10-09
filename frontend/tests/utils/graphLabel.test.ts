import { describe, it, expect } from "vitest";
import { personLabel, wrapLabel } from "~/utils/graphLabel";

describe("wrapLabel", () => {
  it("leaves a name that fits on one line", () => {
    expect(wrapLabel("Jan Kowalski")).toBe("Jan Kowalski");
  });

  it("breaks between words rather than inside one", () => {
    const wrapped = wrapLabel("Anna Maria Wiśniewska-Nowak");
    expect(wrapped.split("\n")).toEqual(["Anna Maria", "Wiśniewska-Nowak"]);
  });

  it("keeps every line within the width", () => {
    const wrapped = wrapLabel(
      "Wojewódzki Fundusz Ochrony Środowiska w Krakowie",
      { maxChars: 18, maxLines: 10 },
    );
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });

  it("cuts a word that is wider than a whole line", () => {
    expect(wrapLabel("a".repeat(25), { maxChars: 10, maxLines: 10 })).toBe(
      "aaaaaaaaaa\naaaaaaaaaa\naaaaa",
    );
  });

  it("ends in an ellipsis rather than growing past the cap", () => {
    const wrapped = wrapLabel(
      "Wojewódzki Fundusz Ochrony Środowiska i Gospodarki Wodnej w Krakowie",
      { maxChars: 18, maxLines: 3 },
    );
    expect(wrapped.split("\n")).toHaveLength(3);
    expect(wrapped.endsWith("…")).toBe(true);
  });

  it("carries the count a group node is labelled with", () => {
    expect(wrapLabel("Ministerstwo (12)", { maxChars: 18 })).toBe(
      "Ministerstwo (12)",
    );
  });

  it("says nothing about a node with no name", () => {
    expect(wrapLabel("")).toBe("");
  });
});

/** The outer ring of a two hop graph, which is where a name runs out of room. */
const RING = { maxChars: 14, maxLines: 2 };

describe("personLabel", () => {
  it("leaves a name that fits alone", () => {
    expect(personLabel("Jan Kowalski", RING)).toBe("Jan Kowalski");
  });

  it("draws the first name and the surname, not the middle one", () => {
    // The page carries every given name the register knows; the caption is
    // what the press would call him.
    expect(personLabel("Sławomir Andrzej Nowicki", RING)).toBe(
      "Sławomir\nNowicki",
    );
  });

  it("does so where the page's own node has room for more", () => {
    expect(personLabel("Sławomir Andrzej Nowicki")).toBe("Sławomir Nowicki");
  });

  it("keeps both halves of a double surname written with a space", () => {
    // "Benc" is nobody's first name, so it is not taken for a middle one.
    expect(personLabel("Zuzanna Benc Szczepaniak", RING)).toBe(
      "Zuzanna Benc\nSzczepaniak",
    );
    expect(personLabel("Urszula Lucyna Wach Górny", RING)).toBe(
      "Urszula Wach\nGórny",
    );
  });

  it("gives up the given name too, where the first name and surname do not fit", () => {
    expect(
      personLabel("Aleksandra Katarzyna Wiśniewska", {
        maxChars: 13,
        maxLines: 1,
      }),
    ).toBe("A. Wiśniewska");
  });

  it("shortens a two-word name whose first word is the long one", () => {
    expect(personLabel("Bogusław-Aleksander Nowak", RING)).toBe("B. Nowak");
  });

  it("still cuts a surname no line can hold", () => {
    const wrapped = personLabel("Jan Rozwadowski-Kwiatkowski", RING);
    expect(wrapped.endsWith("…")).toBe(true);
    expect(wrapped.split("\n")).toHaveLength(2);
  });
});

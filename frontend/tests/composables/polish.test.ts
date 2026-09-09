import { describe, it, expect } from "vitest";
import {
  polishCounting,
  polishCountingGenitive,
  polishCountingGrouped,
  polishNumber,
} from "../../app/composables/polish";

/** The separator `Intl` groups thousands with in Polish. Spelled out so a
 * failing expectation shows „1 284” against „1284” rather than two strings
 * that look identical in the diff. */
const NBSP = "\u00a0";

describe("polishCountingGenitive", () => {
  it("uses the genitive plural after a preposition", () => {
    // The progress bar said „sprawdzono 645 z 1284 osoby” until this existed:
    // `polishCounting` answers in the nominative, and after „z” a count
    // ending in 2-4 wants „osób”.
    expect(polishCountingGenitive(1284, "osoby", "osób")).toBe(
      `1${NBSP}284 osób`,
    );
    expect(polishCountingGenitive(2, "osoby", "osób")).toBe("2 osób");
    expect(polishCountingGenitive(22, "osoby", "osób")).toBe("22 osób");
    expect(polishCountingGenitive(0, "osoby", "osób")).toBe("0 osób");
  });

  it("keeps the singular for exactly one", () => {
    // A filtered table can hold one person, and „z 1 osób” is the one place
    // the two-form rule would show.
    expect(polishCountingGenitive(1, "osoby", "osób")).toBe("1 osoby");
    expect(polishCountingGenitive(21, "osoby", "osób")).toBe("21 osób");
  });

  it("leaves polishCounting's nominative alone", () => {
    // A dozen other sentences and two visual baselines are written against
    // this output; the genitive is a second function for that reason.
    expect(polishCounting(1284, "osoba", "osoby", "osób")).toBe("1284 osoby");
    expect(polishCounting(1, "osoba", "osoby", "osób")).toBe("1 osoba");
  });
});

describe("polishCountingGrouped", () => {
  it("groups the thousands and keeps the nominative", () => {
    // The query bar's row count sits directly above „sprawdzono 645 z 1 284
    // osób”; ungrouped, the two figures did not look like the same number.
    expect(polishCountingGrouped(1284, "osoba", "osoby", "osób")).toBe(
      `1${NBSP}284 osoby`,
    );
    expect(polishCountingGrouped(1, "osoba", "osoby", "osób")).toBe("1 osoba");
    expect(polishCountingGrouped(12, "osoba", "osoby", "osób")).toBe("12 osób");
    expect(polishCountingGrouped(1002, "osoba", "osoby", "osób")).toBe(
      `1${NBSP}002 osoby`,
    );
  });
});

describe("polishNumber", () => {
  it("groups four-digit counts, which the pl locale does not", () => {
    // `Intl.NumberFormat("pl-PL")` on its own answers „1284”: CLDR only starts
    // grouping at five digits, and the table's totals live below that.
    expect(polishNumber(1284)).toBe(`1${NBSP}284`);
    expect(polishNumber(12345)).toBe(`12${NBSP}345`);
    expect(polishNumber(645)).toBe("645");
  });
});

describe("polishCounting", () => {
  it("keeps the singular for a bare one only", () => {
    // The last digit is not the rule. „21 osoba” and „371 rocznica” are what
    // matching on it wrote, and the second of those is what found it - the
    // count of anniversaries on /eksploruj/rocznice is in the low hundreds and
    // lands on a 1 about a tenth of the time.
    expect(polishCounting(1, "osoba", "osoby", "osób")).toBe("1 osoba");
    expect(polishCounting(21, "osoba", "osoby", "osób")).toBe("21 osób");
    expect(polishCounting(101, "osoba", "osoby", "osób")).toBe("101 osób");
    expect(polishCounting(371, "rocznica", "rocznice", "rocznic")).toBe(
      "371 rocznic",
    );
  });

  it("still counts the forms every other digit takes", () => {
    expect(polishCounting(2, "osoba", "osoby", "osób")).toBe("2 osoby");
    expect(polishCounting(22, "osoba", "osoby", "osób")).toBe("22 osoby");
    expect(polishCounting(5, "osoba", "osoby", "osób")).toBe("5 osób");
    expect(polishCounting(11, "osoba", "osoby", "osób")).toBe("11 osób");
    expect(polishCounting(0, "osoba", "osoby", "osób")).toBe("0 osób");
  });
});

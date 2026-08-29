import { describe, it, expect } from "vitest";
import { periodLabel } from "~/utils/period";

/** The five cases the wording was only ever proven through the duration chip.
 * They are asserted directly now because the employment row prints the same
 * string on a phone, where the chip is not rendered at all - so the chip's own
 * spec would no longer notice a change in what a phone reader sees. */
describe("periodLabel", () => {
  it("reads both ends of a closed period", () => {
    expect(periodLabel("2014-11-06", "2017-08-25")).toBe(
      "2014-11-06 - 2017-08-25",
    );
  });

  it("calls an open period ongoing", () => {
    expect(periodLabel("2014-11-06", undefined)).toBe("2014-11-06 - obecnie");
  });

  it("collapses a period that begins and ends on one day", () => {
    expect(periodLabel("2014-11-06", "2014-11-06")).toBe("2014-11-06");
  });

  it("never stringifies a missing start", () => {
    // An edge entered through the editor may carry no start date, and the
    // template that used to interpolate it straight is how 117 published people
    // came to read "undefined - obecnie". "obecnie" is only ever right for the
    // end: a missing start is unknown, not today.
    expect(periodLabel(undefined, "2017-08-25")).toBe("? - 2017-08-25");
  });

  it("says nothing at all when no date was recorded", () => {
    // `connection` carries no date fields in the schema, and the row asks for
    // the label before it asks whether to show it.
    expect(periodLabel(undefined, undefined)).toBe("");
  });

  it("treats an empty string the way it treats a missing date", () => {
    // Firestore hands back "" for a field that was cleared in the editor rather
    // than dropping it, so both ends have to be falsy-checked, not
    // undefined-checked.
    expect(periodLabel("", "")).toBe("");
    expect(periodLabel("2014-11-06", "")).toBe("2014-11-06 - obecnie");
  });
});

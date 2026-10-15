import { describe, it, expect } from "vitest";
import {
  relationPeriodLabel,
  relationPeriodParts,
} from "~/utils/relationPeriod";

describe("relationPeriodLabel", () => {
  it("joins the two ends with an en dash, not a hyphen", () => {
    // „2014-11-06 - 2017-08-25” read as one long number broken by a minus.
    expect(relationPeriodLabel("2014-11-06", "2017-08-25")).not.toContain(
      " - ",
    );
  });

  it("reads both ends of a closed period", () => {
    expect(relationPeriodLabel("2014-11-06", "2017-08-25")).toBe(
      "2014-11-06 – 2017-08-25",
    );
  });

  it("calls an open period ongoing", () => {
    expect(relationPeriodLabel("2014-11-06", undefined)).toBe(
      "2014-11-06 – obecnie",
    );
  });

  it("collapses a period that begins and ends on one day", () => {
    expect(relationPeriodLabel("2014-11-06", "2014-11-06")).toBe("2014-11-06");
  });

  it("never stringifies a missing start", () => {
    // An edge entered through the editor may carry no start date, and the
    // template used to interpolate it straight into the caption - which is how
    // 117 published people came to read "undefined - obecnie". A missing start
    // is unknown, not today, so it is a "?" rather than "obecnie".
    expect(relationPeriodLabel(undefined, "2017-08-25")).toBe("? – 2017-08-25");
  });

  it("says nothing at all when no date was recorded", () => {
    // `connection` edges have no date fields in the schema, and the row asks
    // for a label before it knows that.
    expect(relationPeriodLabel(undefined, undefined)).toBe("");
  });
});

describe("relationPeriodParts", () => {
  it("hands back both ends of a closed period, not current", () => {
    expect(relationPeriodParts("2014-11-06", "2017-08-25")).toEqual({
      start: "2014-11-06",
      end: "2017-08-25",
      current: false,
    });
  });

  it("marks a post still held as current, so the caller can set „obecnie” apart", () => {
    expect(relationPeriodParts("2014-11-06", undefined)).toEqual({
      start: "2014-11-06",
      end: "obecnie",
      current: true,
    });
    // An empty end is as open as a missing one.
    expect(relationPeriodParts("2014-11-06", "")).toEqual({
      start: "2014-11-06",
      end: "obecnie",
      current: true,
    });
  });

  it("gives a missing start as „?”, never today", () => {
    expect(relationPeriodParts(undefined, "2017-08-25")).toEqual({
      start: "?",
      end: "2017-08-25",
      current: false,
    });
  });

  it("has no end to print for a single day or no dates at all", () => {
    expect(relationPeriodParts("2014-11-06", "2014-11-06")).toEqual({
      start: "2014-11-06",
      current: false,
    });
    expect(relationPeriodParts(undefined, undefined)).toEqual({
      start: "",
      current: false,
    });
  });
});

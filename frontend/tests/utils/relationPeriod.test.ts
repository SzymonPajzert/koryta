import { describe, it, expect } from "vitest";
import { relationPeriodLabel } from "~/utils/relationPeriod";

describe("relationPeriodLabel", () => {
  it("reads both ends of a closed period", () => {
    expect(relationPeriodLabel("2014-11-06", "2017-08-25")).toBe(
      "2014-11-06 - 2017-08-25",
    );
  });

  it("calls an open period ongoing", () => {
    expect(relationPeriodLabel("2014-11-06", undefined)).toBe(
      "2014-11-06 - obecnie",
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
    expect(relationPeriodLabel(undefined, "2017-08-25")).toBe("? - 2017-08-25");
  });

  it("says nothing at all when no date was recorded", () => {
    // `connection` edges have no date fields in the schema, and the row asks
    // for a label before it knows that.
    expect(relationPeriodLabel(undefined, undefined)).toBe("");
  });
});

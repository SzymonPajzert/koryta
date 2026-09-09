import { describe, it, expect } from "vitest";
import {
  addYears,
  dayIso,
  dayNumber,
  mergeSpells,
  milestoneDay,
  milestonesInWindow,
} from "../../shared/serviceMilestones";

/** Day numbers are an implementation detail everywhere but here, so the tests
 * are written in ISO days and converted at the edges. */
const d = (iso: string) => dayNumber(iso)!;
const spells = (...pairs: [string, string | null][]) =>
  mergeSpells(pairs.map(([start, end]) => ({ start, end })));
const on = (
  merged: ReturnType<typeof spells>,
  years: number,
  projectTo = d("2100-01-01"),
) => {
  const day = milestoneDay(merged, years, projectTo);
  return day === null ? null : dayIso(day);
};

describe("mergeSpells", () => {
  it("folds two posts held at once into one stretch of service", () => {
    // The same rule calculateExperience applies, and it has to be the same
    // one: this decides when somebody reaches ten years and that decides what
    // the page says their total is.
    expect(
      spells(["2010-01-01", "2014-01-01"], ["2012-01-01", "2016-01-01"]),
    ).toHaveLength(1);
  });

  it("keeps two spells with a gap between them apart", () => {
    expect(
      spells(["2010-01-01", "2012-01-01"], ["2015-01-01", "2017-01-01"]),
    ).toHaveLength(2);
  });

  it("lets a post still held swallow whatever falls inside it", () => {
    const merged = spells(["2010-01-01", null], ["2012-01-01", "2013-01-01"]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.end).toBeNull();
  });

  it("drops a spell that ends before it begins", () => {
    // Counting it would take days off the total rather than add them.
    expect(spells(["2014-01-01", "2010-01-01"])).toEqual([]);
  });

  it("ignores anything that is not an ISO day", () => {
    expect(spells(["2010", null], ["2024-02-31", null])).toEqual([]);
  });
});

describe("addYears", () => {
  it("clamps 29 February rather than rolling it into March", () => {
    expect(dayIso(addYears(d("2016-02-29"), 1))).toBe("2017-02-28");
    expect(dayIso(addYears(d("2016-02-29"), 4))).toBe("2020-02-29");
  });
});

describe("milestoneDay", () => {
  it("lands on the anniversary to the day for an unbroken career", () => {
    // The whole reason a year is measured as a calendar year from the first
    // day served: averaging 365.25 days would put this two days out.
    const merged = spells(["2010-03-15", null]);

    expect(on(merged, 10)).toBe("2020-03-15");
    expect(on(merged, 25)).toBe("2035-03-15");
  });

  it("pushes the milestone back by however long the gap was", () => {
    // Five years, then three years out, then more: the tenth year is reached
    // three years after the date a naive anniversary would name.
    const merged = spells(["2010-01-01", "2015-01-01"], ["2018-01-01", null]);

    expect(on(merged, 10)).toBe("2023-01-01");
  });

  it("counts a spell as end minus start, the way the career total does", () => {
    // 1 January to 31 December is 364 days, not 365 - calculateExperience
    // subtracts the two dates and so does this, because the two numbers appear
    // on the same card and may not disagree. So the first year is one day
    // short here and the next spell carries the remainder.
    const merged = spells(["2010-01-01", "2010-12-31"], ["2011-01-05", null]);

    expect(on(merged, 1)).toBe("2011-01-06");
  });

  it("reaches the mark on the closing day of a spell exactly a year long", () => {
    const merged = spells(["2010-01-01", "2011-01-01"], ["2011-01-02", null]);

    expect(on(merged, 1)).toBe("2011-01-01");
  });

  it("never reaches a milestone the career stopped short of", () => {
    const merged = spells(["2010-01-01", "2015-01-01"]);

    expect(on(merged, 5)).toBe("2015-01-01");
    expect(on(merged, 6)).toBeNull();
  });

  it("stops projecting a running post at the horizon it was given", () => {
    // Without the bound, a post nobody has closed accrues forever and this
    // would promise a sixtieth year in 2086.
    const merged = spells(["2010-01-01", null]);

    expect(on(merged, 20, d("2026-09-09"))).toBeNull();
    expect(on(merged, 16, d("2026-09-09"))).toBe("2026-01-01");
  });

  it("refuses a milestone below one year", () => {
    expect(on(spells(["2010-01-01", null]), 0)).toBeNull();
  });

  it("has nothing to say about somebody who never served", () => {
    expect(on([], 1)).toBeNull();
  });
});

describe("milestonesInWindow", () => {
  it("returns every whole year reached inside the window", () => {
    const merged = spells(["2010-08-20", null]);

    const found = milestonesInWindow(
      merged,
      d("2026-08-10"),
      d("2026-10-09"),
    ).map((m) => ({ years: m.years, day: dayIso(m.day) }));

    expect(found).toEqual([{ years: 16, day: "2026-08-20" }]);
  });

  it("never returns two for one person inside a two-month window", () => {
    // Consecutive milestones are a year of *service* apart and service accrues
    // at most a day a day, so they can never be less than 365 calendar days
    // apart however the career is broken up. Worth pinning: it is what lets
    // the feed be read as one row per person.
    const careers = [
      spells(["2010-08-20", null]),
      spells(["2015-01-01", "2025-07-01"], ["2026-08-01", null]),
      spells(["2000-01-01", "2004-06-30"], ["2019-09-01", null]),
    ];

    for (const merged of careers) {
      const found = milestonesInWindow(
        merged,
        d("2026-08-10"),
        d("2026-10-09"),
      );
      expect(found.length).toBeLessThanOrEqual(1);
    }
  });

  it("skips the ones behind the window without stopping at them", () => {
    const merged = spells(["2000-09-15", null]);

    const found = milestonesInWindow(merged, d("2026-08-10"), d("2026-10-09"));

    // Years 1 to 25 are all behind us; only the 26th falls inside.
    expect(found.map((m) => m.years)).toEqual([26]);
  });

  it("is empty for a career that ended before the window", () => {
    expect(
      milestonesInWindow(
        spells(["2000-01-01", "2005-01-01"]),
        d("2026-08-10"),
        d("2026-10-09"),
      ),
    ).toEqual([]);
  });
});

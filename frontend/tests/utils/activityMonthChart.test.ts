import { describe, it, expect } from "vitest";
import {
  fullDayLabel,
  monthChartOptions,
  niceAxisMax,
  type MonthDay,
} from "~/utils/activityMonthChart";

const day = (date: string, total: number): MonthDay => ({
  date,
  counts: { vote: total, revision: 0, noteSource: 0, publication: 0 },
  total,
});

/** Thirty days ending on Thursday 24 September 2026. */
const month = (totals: number[]): MonthDay[] =>
  totals.map((total, index) => {
    const date = new Date(Date.UTC(2026, 8, 24 - (totals.length - 1 - index)));
    return day(date.toISOString().slice(0, 10), total);
  });

describe("niceAxisMax", () => {
  it("ends the axis just above the busiest day", () => {
    expect(niceAxisMax(95)).toBe(100);
    expect(niceAxisMax(101)).toBe(120);
    expect(niceAxisMax(253)).toBe(300);
    expect(niceAxisMax(1234)).toBe(1500);
  });

  it("keeps the middle tick a whole number of changes", () => {
    expect(niceAxisMax(1)).toBe(2);
    expect(niceAxisMax(7)).toBe(8);
    // 15 would put the middle tick at 7.5.
    expect(niceAxisMax(13)).toBe(20);
  });

  it("never leaves the tallest column in the bottom half", () => {
    for (let max = 3; max <= 5000; max++) {
      const top = niceAxisMax(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(top % 2).toBe(0);
      expect(top / max).toBeLessThan(1.6);
    }
  });

  it("still draws an axis for a month with nothing in it", () => {
    expect(niceAxisMax(0)).toBe(2);
  });
});

describe("fullDayLabel", () => {
  it("names the weekday for the tooltip", () => {
    expect(fullDayLabel("2026-09-24")).toBe("czw., 24 wrz");
  });

  it("hands back what it cannot read", () => {
    expect(fullDayLabel("wczoraj")).toBe("wczoraj");
  });
});

describe("month chart options", () => {
  const daily = month(Array.from({ length: 30 }, (_, index) => index * 3));

  it("scales the axis to the busiest day", () => {
    expect(monthChartOptions(daily).yaxis.max).toBe(100);
  });

  it("labels today and every seventh day before it", () => {
    const { categories, labels } = monthChartOptions(daily).xaxis;
    const shown = categories
      .map((category, i) => labels.formatter(category, category, { i }))
      .filter(Boolean);
    expect(shown).toEqual(["27 sie", "3 wrz", "10 wrz", "17 wrz", "24 wrz"]);
  });

  it("breaks the day under the pointer down by kind", () => {
    const busy = month(Array.from({ length: 30 }, () => 0));
    busy[29] = {
      date: "2026-09-24",
      counts: { vote: 12, revision: 1162, noteSource: 44, publication: 35 },
      total: 1253,
    };
    const tooltip = monthChartOptions(busy).tooltip.custom;
    const html = tooltip({ dataPointIndex: 29 });

    expect(html).toContain("czw., 24 wrz");
    expect(html).toContain("1253 zmiany");
    expect(html).toContain("<span>Propozycja zmiany</span><b>1162</b>");
    expect(html).toContain("<span>Ocena</span><b>12</b>");
    expect(tooltip({ dataPointIndex: 30 })).toBe("");
  });
});

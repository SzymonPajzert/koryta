import { describe, it, expect } from "vitest";
import { dayLabelStep, everyNthDayLabel } from "~/utils/chartTheme";

/** The plot of „Co się działo w bazie” at 375px: the page's and the card's
 * padding and the value axis leave about 227px for the columns. */
const PHONE_PLOT_PX = 227;
/** The same at 1280px, where the page stops at 1200. */
const DESKTOP_PLOT_PX = 1050;

describe("dayLabelStep", () => {
  it("labels a phone's month once a week", () => {
    expect(dayLabelStep(30, PHONE_PLOT_PX)).toBe(7);
  });

  it("keeps a desktop's month at every other day", () => {
    expect(dayLabelStep(30, DESKTOP_PLOT_PX)).toBe(2);
  });

  it("labels every day of a week only where the days are wide enough", () => {
    expect(dayLabelStep(7, DESKTOP_PLOT_PX)).toBe(1);
    expect(dayLabelStep(7, PHONE_PLOT_PX)).toBe(2);
  });

  it("goes past weekly on a phone's quarter", () => {
    expect(dayLabelStep(90, DESKTOP_PLOT_PX)).toBe(7);
    expect(dayLabelStep(90, PHONE_PLOT_PX)).toBe(28);
  });

  it("leaves no two labels closer than a date is wide", () => {
    for (const days of [7, 30, 90]) {
      for (let plot = 200; plot <= 1200; plot += 10) {
        expect(dayLabelStep(days, plot) * (plot / days)).toBeGreaterThanOrEqual(
          48,
        );
      }
    }
  });
});

describe("everyNthDayLabel", () => {
  const days = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const shown = (step: number) => {
    const format = everyNthDayLabel(days.length, step);
    return days.map((day, i) => format(day, day, { i })).filter(Boolean);
  };

  it("counts back from the last day, so today always has a label", () => {
    expect(shown(3)).toEqual(["1", "4", "7", "10"]);
    expect(shown(7)).toEqual(["3", "10"]);
  });

  it("gives the tooltip, which passes no index, nothing", () => {
    expect(everyNthDayLabel(days.length, 1)("5", undefined, {})).toBe("");
  });
});

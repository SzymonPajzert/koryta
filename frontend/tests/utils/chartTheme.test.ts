import { describe, it, expect } from "vitest";
import {
  dayLabelStep,
  everyNthDayLabel,
  formatDayRange,
  formatShare,
  rankedTooltip,
} from "~/utils/chartTheme";

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

describe("formatDayRange", () => {
  it("names a week by its days, the month once", () => {
    expect(formatDayRange("2026-10-19", "2026-10-25")).toBe("19-25 paź");
  });

  it("names both months across a month's end", () => {
    expect(formatDayRange("2026-09-28", "2026-10-04")).toBe("28 wrz-4 paź");
  });

  it("names a single day as itself", () => {
    expect(formatDayRange("2026-10-28", "2026-10-28")).toBe("28 paź");
  });
});

describe("formatShare", () => {
  it("gives a part's share of its column, then its count", () => {
    expect(formatShare(19, 38)).toBe("50% (19)");
    expect(formatShare(1, 3)).toBe("33% (1)");
  });

  it("calls an empty column's parts nothing", () => {
    expect(formatShare(0, 0)).toBe("0% (0)");
  });
});

describe("rankedTooltip", () => {
  const lines = [
    { name: "Województwo mazowieckie", color: "blue" },
    { name: "Województwo śląskie", color: "orange" },
    { name: "Pozostałe województwa", color: "grey" },
  ];
  const tooltip = rankedTooltip(
    () => lines,
    (index) => `month ${index}`,
  );

  /** The rows as a reader reads them, top down, and the title above them. */
  function read(html: string) {
    const box = document.createElement("div");
    box.innerHTML = html;
    return {
      title: box.querySelector(".apexcharts-tooltip-title")?.textContent,
      rows: [...box.querySelectorAll(".apexcharts-tooltip-series-group")].map(
        (row) => row.textContent,
      ),
    };
  }

  it("lists the rows in the order of the lines at the hovered point", () => {
    // Series order puts the folded remainder last; at point 1 it is the
    // highest line, and at point 0 the lowest.
    const series = [
      [80, 400],
      [30, 230],
      [7, 650],
    ];

    expect(read(tooltip({ series, dataPointIndex: 1 })).rows).toEqual([
      "Pozostałe województwa: 650",
      "Województwo mazowieckie: 400",
      "Województwo śląskie: 230",
    ]);
    expect(read(tooltip({ series, dataPointIndex: 0 })).rows).toEqual([
      "Województwo mazowieckie: 80",
      "Województwo śląskie: 30",
      "Pozostałe województwa: 7",
    ]);
  });

  it("keeps series order between lines that meet", () => {
    const series = [[5], [9], [9]];

    expect(read(tooltip({ series, dataPointIndex: 0 })).rows).toEqual([
      "Województwo śląskie: 9",
      "Pozostałe województwa: 9",
      "Województwo mazowieckie: 5",
    ]);
  });

  it("drops a line hidden from the legend, whose data apexcharts empties", () => {
    const series = [[80], [], [650]];

    expect(read(tooltip({ series, dataPointIndex: 0 })).rows).toEqual([
      "Pozostałe województwa: 650",
      "Województwo mazowieckie: 80",
    ]);
  });

  it("titles the tooltip with the hovered point and colours each marker", () => {
    const html = tooltip({ series: [[1], [2], [3]], dataPointIndex: 0 });

    expect(read(html).title).toBe("month 0");
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(
      [...box.querySelectorAll<HTMLElement>(".apexcharts-tooltip-marker")].map(
        (marker) => marker.style.color,
      ),
    ).toEqual(["grey", "orange", "blue"]);
  });

  it("writes a count as the rest of the site does", () => {
    const html = tooltip({ series: [[12345], [0], [0]], dataPointIndex: 0 });

    expect(read(html).rows[0]).toBe("Województwo mazowieckie: 12 345");
  });
});

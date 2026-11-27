import { describe, it, expect } from "vitest";
import type { TimelineSeries } from "../../shared/homeTimeline";
import {
  CARD_POINTS,
  CARD_SCALE,
  decodeStack,
  decodeTicks,
  encodeStack,
  encodeTicks,
  partyStackCardProps,
  partyStackHeading,
} from "../../shared/partyStackCard";
// Not exported by the package: the encoder the card's url really goes
// through, so a change to it shows up here rather than as a blank preview.
import {
  decodeOgImageParams,
  encodeOgImageParams,
} from "../../node_modules/nuxt-og-image/dist/runtime/shared/urlEncoding.js";

/** Every month from `from` to `to`, both included, as „2014-01”. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number) as [number, number];
  const [endYear, endMonth] = to.split("-").map(Number) as [number, number];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

const band = (key: string, counts: number[]): TimelineSeries => ({
  key,
  label: key,
  counts,
});

/** 2001-02 to 2026-11, PiS growing, PO flat, a sliver of „Inne”. */
function siteStack() {
  const months = monthsBetween("2001-02", "2026-11");
  return {
    months,
    series: [
      band(
        "PO",
        months.map(() => 300.5),
      ),
      band(
        "PiS",
        months.map((_, i) => i * 2.25),
      ),
      band(
        "Inne",
        months.map(() => 12),
      ),
    ],
  };
}

describe("encodeStack and decodeStack", () => {
  it("give back the bands and their heights", () => {
    const stack = {
      keys: ["PO", "PiS", "Inne"],
      heights: [
        [0, 35, 1000],
        [7, 0, 36],
        [1, 2, 3],
      ],
    };
    expect(decodeStack(encodeStack(stack))).toEqual(stack);
  });

  it("writes only what a url carries as it is", () => {
    const encoded = encodeStack({
      keys: ["PO", "Bezpartyjni Samorządowcy", "Inne"],
      heights: [
        [0, 999, 1000],
        [1295, 12, 5],
        [3, 4, 5],
      ],
    });
    expect(encoded).toMatch(/^[0-9a-z.!]+$/);
  });

  it("leaves out a band it cannot name rather than drawing it as another", () => {
    expect(decodeStack("0.99.x.1!0a0b!0c0d!0e0f!0g0h")).toEqual({
      keys: ["PO", "PiS"],
      heights: [
        [10, 11],
        [16, 17],
      ],
    });
  });

  it("draws nothing from nothing", () => {
    expect(decodeStack(undefined)).toEqual({ keys: [], heights: [] });
    expect(decodeStack("")).toEqual({ keys: [], heights: [] });
    expect(decodeStack(2026)).toEqual({ keys: [], heights: [] });
  });
});

describe("encodeTicks and decodeTicks", () => {
  it("give back the years and where they fall", () => {
    const ticks = [
      { year: 2005, at: 15 },
      { year: 2010, at: 208 },
    ];
    expect(decodeTicks(encodeTicks(ticks))).toEqual(ticks);
  });

  it("skips what is not a year and a place", () => {
    expect(decodeTicks("2005-15!x-1!20-3!2010-9999")).toEqual([
      { year: 2005, at: 15 },
      { year: 2010, at: CARD_SCALE },
    ]);
    expect(decodeTicks(undefined)).toEqual([]);
  });
});

describe("partyStackHeading", () => {
  it("names the category the chart is cut to", () => {
    expect(partyStackHeading("szpitale")).toBe(
      "Stanowiska wg partii: Szpitale",
    );
  });

  it("names none for every institution, or one it does not know", () => {
    expect(partyStackHeading(null)).toBe("Stanowiska wg partii");
    expect(partyStackHeading("nie-ma-takiej")).toBe("Stanowiska wg partii");
  });
});

describe("partyStackCardProps", () => {
  it("draws the whole range when no years are picked", () => {
    const card = partyStackCardProps(siteStack(), null, null)!;
    expect(card.heading).toBe("Stanowiska wg partii");
    expect(card.years).toBe("2001-2026");
    const { keys, heights } = decodeStack(card.stack);
    expect(keys).toEqual(["PO", "PiS", "Inne"]);
    expect(heights.every((row) => row.length === CARD_POINTS)).toBe(true);
    expect(decodeTicks(card.ticks).map((tick) => tick.year)).toEqual([
      2005, 2010, 2015, 2020, 2025,
    ]);
  });

  it("tops the tallest point out at the scale, and no band below zero", () => {
    const { heights } = decodeStack(
      partyStackCardProps(siteStack(), null, null)!.stack,
    );
    const tops = heights[0]!.map((_, i) =>
      heights.reduce((sum, row) => sum + row[i]!, 0),
    );
    expect(Math.max(...tops)).toBe(CARD_SCALE);
    expect(heights.flat().every((height) => height >= 0)).toBe(true);
  });

  it("keeps the outline of the stack where the counts put it", () => {
    // Rounded as running totals: three bands each rounded on their own could
    // land the top up to a unit and a half off.
    const months = monthsBetween("2020-01", "2020-03");
    const card = partyStackCardProps(
      {
        months,
        series: [
          band("PO", [1.4, 1.4, 1.4]),
          band("PiS", [1.4, 1.4, 1.4]),
          band("PSL", [1.4, 1.4, 997.8]),
        ],
      },
      null,
      null,
    )!;
    const { heights } = decodeStack(card.stack);
    const tops = heights[0]!.map((_, i) =>
      heights.reduce((sum, row) => sum + row[i]!, 0),
    );
    expect(tops).toEqual([4, 4, 1000]);
  });

  it("cuts to the picked years, labelling every other one", () => {
    const card = partyStackCardProps(siteStack(), [2014, 2026], "szpitale")!;
    expect(card.heading).toBe("Stanowiska wg partii: Szpitale");
    expect(card.years).toBe("2014-2026");
    const ticks = decodeTicks(card.ticks);
    expect(ticks.map((tick) => tick.year)).toEqual([
      2014, 2016, 2018, 2020, 2022, 2024, 2026,
    ]);
    expect(ticks[0]!.at).toBe(0);
    // 2026-01 is month 144 of the 154 from 2014-01 to 2026-11.
    expect(ticks.at(-1)!.at).toBe(Math.round((144 / 154) * CARD_SCALE));
  });

  it("keeps years outside the data to the data", () => {
    const card = partyStackCardProps(siteStack(), [1990, 9999], null)!;
    expect(card.years).toBe("2001-2026");
  });

  it("draws a short range month by month", () => {
    const card = partyStackCardProps(siteStack(), [2025, 2026], null)!;
    const { heights } = decodeStack(card.stack);
    // 2025-01 to 2026-11.
    expect(heights[0]).toHaveLength(23);
    expect(decodeTicks(card.ticks).map((tick) => tick.year)).toEqual([
      2025, 2026,
    ]);
  });

  it("widens one month to two, as the page does", () => {
    const months = monthsBetween("2025-12", "2026-03");
    const stack = { months, series: [band("PO", [5, 1, 2, 3])] };
    // 2025 has one month here, its December, drawn with January beside it.
    const card = partyStackCardProps(stack, [2025, 2025], null)!;
    expect(card.years).toBe("2025-2026");
    expect(decodeStack(card.stack).heights[0]).toEqual([1000, 200]);
    // 2026 has three, and keeps to them.
    expect(partyStackCardProps(stack, [2026, 2026], null)!.years).toBe("2026");
  });

  it("gives no card when there is nothing to draw", () => {
    const months = monthsBetween("2020-01", "2020-12");
    expect(partyStackCardProps({ months, series: [] }, null, null)).toBeNull();
    expect(
      partyStackCardProps(
        { months: ["2020-01"], series: [band("PO", [3])] },
        null,
        null,
      ),
    ).toBeNull();
    expect(
      partyStackCardProps(
        {
          months,
          series: [
            band(
              "PO",
              months.map(() => 0),
            ),
          ],
        },
        null,
        null,
      ),
    ).toBeNull();
    // A band the url has no name for is not drawn at all.
    expect(
      partyStackCardProps(
        {
          months,
          series: [
            band(
              "Samoobrona",
              months.map(() => 4),
            ),
          ],
        },
        null,
        null,
      ),
    ).toBeNull();
  });

  it("survives the card's url, every prop as it went in", () => {
    // Seven bands, as many as any category has had.
    const months = monthsBetween("2001-02", "2026-11");
    const keys = [
      "PO",
      "PiS",
      "PSL",
      "Polska 2050",
      "Nowa Lewica",
      "Bezpartyjni Samorządowcy",
      "Inne",
    ];
    const series = keys.map((key, k) =>
      band(
        key,
        months.map((_, i) => ((i * (k + 3)) % 97) + k * 11.5),
      ),
    );
    const card = partyStackCardProps(
      { months, series },
      [2014, 2026],
      "skarb-panstwa",
    )!;
    const encoded = encodeOgImageParams({
      component: "PartyStackCard",
      props: card,
    });
    expect(decodeOgImageParams(encoded).props).toEqual(card);
    expect(decodeStack(card.stack).keys).toEqual(keys);
    expect(encoded.length).toBeLessThan(1000);
  });
});

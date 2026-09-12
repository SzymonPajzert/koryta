import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  effectiveEnd,
  monthIndex,
  monthKey,
  OTHER_KEY,
  type HeldPost,
} from "../../shared/homeTimeline";

const TODAY = "2026-09-12";

const post = (over: Partial<HeldPost> = {}): HeldPost => ({
  personId: "p1",
  groups: ["PiS"],
  start: "2026-01-10",
  end: null,
  ...over,
});

/** The counts for one group, which is what nearly every case here is about. */
function counts(
  timeline: ReturnType<typeof buildTimeline>,
  group: string,
): number[] | undefined {
  return timeline.series.find((line) => line.key === group)?.counts;
}

describe("monthIndex / monthKey", () => {
  it("round-trips a month", () => {
    expect(monthKey(monthIndex("2026-09-12")!)).toBe("2026-09");
  });

  it("counts the gap between two months", () => {
    expect(monthIndex("2026-01-01")! - monthIndex("2025-11-30")!).toBe(2);
  });

  it("refuses what is not a date", () => {
    expect(monthIndex(null)).toBeNull();
    expect(monthIndex("2026")).toBeNull();
    expect(monthIndex("2026-13-01")).toBeNull();
  });
});

describe("effectiveEnd", () => {
  it("keeps an end date somebody actually left on", () => {
    expect(effectiveEnd("2024-05-06")).toBe("2024-05-06");
  });

  it("reads the bulk crawl stamp as a post still held", () => {
    // 205 published employments across 201 institutions carry this date. It is
    // when the ingest last looked, not when anybody left.
    expect(effectiveEnd("2026-03-18")).toBeNull();
    expect(effectiveEnd("2026-03-18T00:00:00Z")).toBeNull();
  });

  it("treats a blank end as open", () => {
    expect(effectiveEnd("")).toBeNull();
    expect(effectiveEnd(undefined)).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("counts a post in every month from its start to its end, inclusive", () => {
    const timeline = buildTimeline(
      [post({ start: "2026-06-30", end: "2026-08-01" })],
      TODAY,
    );

    expect(timeline.months).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(counts(timeline, "PiS")).toEqual([1, 1, 1, 0]);
  });

  it("runs an open post to the month of today", () => {
    const timeline = buildTimeline([post({ start: "2026-07-01" })], TODAY);

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("counts a person once in a month they hold two posts", () => {
    // The whole reason the spans are merged: a board member of three companies
    // is one person on the chart, not three.
    const timeline = buildTimeline(
      [
        post({ start: "2026-07-01", end: "2026-09-01" }),
        post({ start: "2026-08-01", end: "2026-09-01" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("counts a person once across posts that touch but do not overlap", () => {
    const timeline = buildTimeline(
      [
        post({ start: "2026-07-01", end: "2026-07-31" }),
        post({ start: "2026-08-01", end: "2026-09-30" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("drops a person out for the months between two spells", () => {
    const timeline = buildTimeline(
      [
        post({ start: "2026-05-01", end: "2026-05-31" }),
        post({ start: "2026-08-01", end: "2026-08-31" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 0, 0, 1, 0]);
  });

  it("counts two people in the same month separately", () => {
    const timeline = buildTimeline(
      [
        post({ personId: "a", start: "2026-08-01" }),
        post({ personId: "b", start: "2026-08-01" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([2, 2]);
  });

  it("counts somebody in two groups on both lines", () => {
    // Deliberate, and the reason the chart draws lines rather than a stack:
    // there is no way to tell which of a person's two parties got them the
    // seat, and a career spanning two województwa belongs to both.
    const timeline = buildTimeline(
      [post({ groups: ["PO", "PSL"], start: "2026-09-01" })],
      TODAY,
    );

    expect(counts(timeline, "PO")).toEqual([1]);
    expect(counts(timeline, "PSL")).toEqual([1]);
  });

  it("counts a group named twice on one post only once", () => {
    // What a caller folding SLD into Nowa Lewica hands over.
    const timeline = buildTimeline(
      [post({ groups: ["Nowa Lewica", "Nowa Lewica"], start: "2026-09-01" })],
      TODAY,
    );

    expect(timeline.series).toHaveLength(1);
    expect(counts(timeline, "Nowa Lewica")).toEqual([1]);
  });

  it("orders the lines by how high each one ever reaches", () => {
    const timeline = buildTimeline(
      [
        post({ personId: "a", groups: ["PO"], start: "2026-01-01" }),
        post({ personId: "b", groups: ["PO"], start: "2026-01-01" }),
        post({ personId: "c", groups: ["PiS"], start: "2026-01-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.key)).toEqual(["PO", "PiS"]);
  });

  it("orders by the peak rather than by where the lines end", () => {
    // A party out of office now still belongs where its story is.
    const ended = { start: "2026-01-01", end: "2026-02-01" };
    const timeline = buildTimeline(
      [
        post({ personId: "a", groups: ["PiS"], ...ended }),
        post({ personId: "b", groups: ["PiS"], ...ended }),
        post({ personId: "c", groups: ["PiS"], ...ended }),
        post({ personId: "d", groups: ["PO"], start: "2026-01-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.key)).toEqual(["PiS", "PO"]);
  });

  it("labels a line with what the caller calls it", () => {
    const timeline = buildTimeline(
      [post({ groups: ["14"], start: "2026-09-01" })],
      TODAY,
      { labelOf: (key) => (key === "14" ? "Województwo mazowieckie" : key) },
    );

    expect(timeline.series[0]!.label).toBe("Województwo mazowieckie");
  });

  it("gives every line the same length as the month axis", () => {
    const timeline = buildTimeline(
      [
        post({
          personId: "a",
          groups: ["PO"],
          start: "2001-03-01",
          end: "2001-04-01",
        }),
        post({ personId: "b", groups: ["PiS"], start: "2026-09-01" }),
      ],
      TODAY,
    );

    for (const line of timeline.series) {
      expect(line.counts).toHaveLength(timeline.months.length);
    }
    expect(timeline.months[0]).toBe("2001-03");
    expect(timeline.months.at(-1)).toBe("2026-09");
  });

  it("ignores a post that has not started yet", () => {
    const timeline = buildTimeline(
      [
        post({ personId: "a", start: "2026-09-01" }),
        post({ personId: "b", start: "2027-01-01" }),
      ],
      TODAY,
    );

    expect(timeline.months).toEqual(["2026-09"]);
    expect(counts(timeline, "PiS")).toEqual([1]);
  });

  it("stops a post that outlives today at today", () => {
    const timeline = buildTimeline(
      [post({ start: "2026-08-01", end: "2030-01-01" })],
      TODAY,
    );

    expect(timeline.months).toEqual(["2026-08", "2026-09"]);
    expect(counts(timeline, "PiS")).toEqual([1, 1]);
  });

  it("reads an end before the start as a post lasting its own month", () => {
    const timeline = buildTimeline(
      [post({ start: "2026-08-01", end: "2020-01-01" })],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 0]);
  });

  it("returns nothing at all when no post can be placed", () => {
    expect(buildTimeline([], TODAY)).toEqual({ months: [], series: [] });
    expect(buildTimeline([post({ start: "not a date" })], TODAY)).toEqual({
      months: [],
      series: [],
    });
  });

  it("drops a post with no group rather than inventing a line for it", () => {
    const timeline = buildTimeline(
      [
        post({ personId: "a", groups: [], start: "2026-09-01" }),
        post({ personId: "b", groups: ["PO"], start: "2026-09-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.key)).toEqual(["PO"]);
  });

  describe("opening the axis earlier than the data", () => {
    it("pads the front so two groupings can share an axis", () => {
      const timeline = buildTimeline([post({ start: "2026-08-01" })], TODAY, {
        from: "2026-06",
      });

      expect(timeline.months).toEqual([
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
      ]);
      expect(counts(timeline, "PiS")).toEqual([0, 0, 1, 1]);
    });

    it("ignores a start later than the data, which would cut it off", () => {
      const timeline = buildTimeline([post({ start: "2026-06-01" })], TODAY, {
        from: "2026-08",
      });

      expect(timeline.months[0]).toBe("2026-06");
    });
  });

  describe("folding the tail", () => {
    /** `n` groups, one person each, all in post for the same single month. The
     * peaks are staggered by giving the bigger groups more people. */
    function ladder(size: number): HeldPost[] {
      const posts: HeldPost[] = [];
      for (let group = 0; group < size; group += 1) {
        for (let person = 0; person <= size - group; person += 1) {
          posts.push(
            post({
              personId: `g${group}-p${person}`,
              groups: [`g${group}`],
              start: "2026-09-01",
            }),
          );
        }
      }
      return posts;
    }

    it("leaves a chart at the limit alone", () => {
      const timeline = buildTimeline(ladder(8), TODAY, { maxSeries: 8 });

      expect(timeline.series).toHaveLength(8);
      expect(timeline.series.map((line) => line.key)).not.toContain(OTHER_KEY);
    });

    it("folds everything past the limit into one line", () => {
      const timeline = buildTimeline(ladder(12), TODAY, { maxSeries: 8 });

      expect(timeline.series).toHaveLength(8);
      expect(timeline.series.at(-1)!.key).toBe(OTHER_KEY);
      // The seven largest survive under their own names.
      expect(timeline.series.slice(0, 7).map((line) => line.key)).toEqual([
        "g0",
        "g1",
        "g2",
        "g3",
        "g4",
        "g5",
        "g6",
      ]);
    });

    it("counts a person in two folded groups once in the remainder", () => {
      // The reason the fold re-counts from the spans instead of summing the
      // lines it replaces. Seven groups of two clear the cut; the two that do
      // not share their only person, so summing would make „pozostałe” say 2.
      const timeline = buildTimeline(
        [
          ...Array.from({ length: 7 }, (_, group) => [
            post({
              personId: `big${group}-a`,
              groups: [`big${group}`],
              start: "2026-01-01",
            }),
            post({
              personId: `big${group}-b`,
              groups: [`big${group}`],
              start: "2026-01-01",
            }),
          ]).flat(),
          post({ personId: "shared", groups: ["tiny-a"], start: "2026-09-01" }),
          post({ personId: "shared", groups: ["tiny-b"], start: "2026-09-01" }),
        ],
        TODAY,
        { maxSeries: 8 },
      );

      const other = timeline.series.find((line) => line.key === OTHER_KEY);
      expect(other).toBeDefined();
      expect(other!.counts.at(-1)).toBe(1);
    });

    it("names the remainder what the caller asks", () => {
      const timeline = buildTimeline(ladder(12), TODAY, {
        maxSeries: 8,
        otherLabel: "Pozostałe województwa",
      });

      expect(timeline.series.at(-1)!.label).toBe("Pozostałe województwa");
    });
  });
});

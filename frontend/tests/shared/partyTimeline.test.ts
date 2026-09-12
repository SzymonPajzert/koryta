import { describe, it, expect } from "vitest";
import {
  buildPartyTimeline,
  effectiveEnd,
  monthIndex,
  monthKey,
  type HeldPost,
} from "../../shared/partyTimeline";

const TODAY = "2026-09-12";

const post = (over: Partial<HeldPost> = {}): HeldPost => ({
  personId: "p1",
  parties: ["PiS"],
  start: "2026-01-10",
  end: null,
  ...over,
});

/** The counts for one party, which is what nearly every case here is about. */
function counts(
  timeline: ReturnType<typeof buildPartyTimeline>,
  party: string,
) {
  return timeline.series.find((line) => line.party === party)?.counts;
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

describe("buildPartyTimeline", () => {
  it("counts a post in every month from its start to its end, inclusive", () => {
    const timeline = buildPartyTimeline(
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
    const timeline = buildPartyTimeline([post({ start: "2026-07-01" })], TODAY);

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("counts a person once in a month they hold two posts", () => {
    // The whole reason the spans are merged: a board member of three companies
    // is one person on the chart, not three.
    const timeline = buildPartyTimeline(
      [
        post({ start: "2026-07-01", end: "2026-09-01" }),
        post({ start: "2026-08-01", end: "2026-09-01" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("counts a person once across posts that touch but do not overlap", () => {
    const timeline = buildPartyTimeline(
      [
        post({ start: "2026-07-01", end: "2026-07-31" }),
        post({ start: "2026-08-01", end: "2026-09-30" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 1, 1]);
  });

  it("drops a person out for the months between two spells", () => {
    const timeline = buildPartyTimeline(
      [
        post({ start: "2026-05-01", end: "2026-05-31" }),
        post({ start: "2026-08-01", end: "2026-08-31" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 0, 0, 1, 0]);
  });

  it("counts two people in the same month separately", () => {
    const timeline = buildPartyTimeline(
      [
        post({ personId: "a", start: "2026-08-01" }),
        post({ personId: "b", start: "2026-08-01" }),
      ],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([2, 2]);
  });

  it("counts somebody filed under two parties on both lines", () => {
    // Deliberate, and the reason the chart draws lines rather than a stack:
    // there is no way to tell which affiliation got them the seat.
    const timeline = buildPartyTimeline(
      [post({ parties: ["PO", "PSL"], start: "2026-09-01" })],
      TODAY,
    );

    expect(counts(timeline, "PO")).toEqual([1]);
    expect(counts(timeline, "PSL")).toEqual([1]);
  });

  it("folds SLD into Nowa Lewica without counting the seat twice", () => {
    const timeline = buildPartyTimeline(
      [post({ parties: ["SLD", "Nowa Lewica"], start: "2026-09-01" })],
      TODAY,
    );

    expect(timeline.series).toHaveLength(1);
    expect(counts(timeline, "Nowa Lewica")).toEqual([1]);
  });

  it("orders the lines by how high each one ever reaches", () => {
    const timeline = buildPartyTimeline(
      [
        post({ personId: "a", parties: ["PO"], start: "2026-01-01" }),
        post({ personId: "b", parties: ["PO"], start: "2026-01-01" }),
        post({ personId: "c", parties: ["PiS"], start: "2026-01-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.party)).toEqual(["PO", "PiS"]);
  });

  it("orders by the peak rather than by where the lines end", () => {
    // A party out of office now still belongs where its story is.
    const timeline = buildPartyTimeline(
      [
        post({
          personId: "a",
          parties: ["PiS"],
          start: "2026-01-01",
          end: "2026-02-01",
        }),
        post({
          personId: "b",
          parties: ["PiS"],
          start: "2026-01-01",
          end: "2026-02-01",
        }),
        post({
          personId: "c",
          parties: ["PiS"],
          start: "2026-01-01",
          end: "2026-02-01",
        }),
        post({ personId: "d", parties: ["PO"], start: "2026-01-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.party)).toEqual(["PiS", "PO"]);
  });

  it("gives every line the same length as the month axis", () => {
    const timeline = buildPartyTimeline(
      [
        post({
          personId: "a",
          parties: ["PO"],
          start: "2001-03-01",
          end: "2001-04-01",
        }),
        post({ personId: "b", parties: ["PiS"], start: "2026-09-01" }),
      ],
      TODAY,
    );

    for (const line of timeline.series) {
      expect(line.counts).toHaveLength(timeline.months.length);
    }
    expect(timeline.months[0]).toBe("2001-03");
    expect(timeline.months[timeline.months.length - 1]).toBe("2026-09");
  });

  it("ignores a post that has not started yet", () => {
    const timeline = buildPartyTimeline(
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
    const timeline = buildPartyTimeline(
      [post({ start: "2026-08-01", end: "2030-01-01" })],
      TODAY,
    );

    expect(timeline.months).toEqual(["2026-08", "2026-09"]);
    expect(counts(timeline, "PiS")).toEqual([1, 1]);
  });

  it("reads an end before the start as a post lasting its own month", () => {
    const timeline = buildPartyTimeline(
      [post({ start: "2026-08-01", end: "2020-01-01" })],
      TODAY,
    );

    expect(counts(timeline, "PiS")).toEqual([1, 0]);
  });

  it("returns nothing at all when no post can be placed", () => {
    expect(buildPartyTimeline([], TODAY)).toEqual({ months: [], series: [] });
    expect(buildPartyTimeline([post({ start: "not a date" })], TODAY)).toEqual({
      months: [],
      series: [],
    });
  });

  it("drops a post with no party rather than inventing a line for it", () => {
    const timeline = buildPartyTimeline(
      [
        post({ personId: "a", parties: [], start: "2026-09-01" }),
        post({ personId: "b", parties: ["PO"], start: "2026-09-01" }),
      ],
      TODAY,
    );

    expect(timeline.series.map((line) => line.party)).toEqual(["PO"]);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDayDistance, formatMoment } from "../../app/utils/moment";

/** The one clock the revision pages print. Each row used to call
 * `toLocaleString("pl-PL")` of its own, which wrote „1.09.2026, 11:00:00”:
 * seconds nobody decides by, in the browser's zone rather than Warsaw's. */
describe("formatMoment", () => {
  it("writes the day and the minute in Warsaw, without seconds", () => {
    // Noon UTC in December is 13:00 in Warsaw (CET, UTC+1).
    expect(formatMoment("2024-12-01T12:00:00Z")).toBe("01.12.2024 13:00");
    // Seconds are dropped, not rounded up into the next minute.
    expect(formatMoment("2024-12-01T12:00:59.999Z")).toBe("01.12.2024 13:00");
    // No comma between the date and the time, as in the history list.
    expect(formatMoment("2024-12-01T12:00:00Z")).not.toContain(",");
  });

  it("takes epoch milliseconds as well as an ISO string", () => {
    expect(formatMoment(Date.parse("2024-12-01T12:00:00Z"))).toBe(
      "01.12.2024 13:00",
    );
  });

  it("dates a moment by Warsaw's calendar, not UTC's", () => {
    // 23:30 UTC on New Year's Eve is already the new year in Warsaw.
    expect(formatMoment("2024-12-31T23:30:00Z")).toBe("01.01.2025 00:30");
  });

  // Summer time starts at 02:00 CET on the last Sunday of March - the clock
  // goes from 01:59 straight to 03:00 - and ends at 03:00 CEST on the last
  // Sunday of October, when 02:00-02:59 happens twice.
  it("follows Warsaw's clock across the summer-time changes", () => {
    expect(formatMoment("2026-03-29T00:59:00Z")).toBe("29.03.2026 01:59");
    expect(formatMoment("2026-03-29T01:00:00Z")).toBe("29.03.2026 03:00");
    expect(formatMoment("2026-10-25T00:30:00Z")).toBe("25.10.2026 02:30");
    expect(formatMoment("2026-10-25T01:30:00Z")).toBe("25.10.2026 02:30");
    // And summer time itself is UTC+2.
    expect(formatMoment("2026-07-01T10:00:00Z")).toBe("01.07.2026 12:00");
  });

  it("prints a dash for a moment that is missing or unreadable", () => {
    expect(formatMoment(null)).toBe("—");
    expect(formatMoment(undefined)).toBe("—");
    expect(formatMoment("")).toBe("—");
    expect(formatMoment("nie data")).toBe("—");
    expect(formatMoment(Number.NaN)).toBe("—");
  });
});

/** How many Warsaw calendar days ago, printed under `formatMoment` - so it has
 * to count the days that one prints. Counting 24-hour blocks put a revision
 * filed at 22:41 yesterday under „dzisiaj” two hours later. */
describe("formatDayDistance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Now, as Warsaw reads it: 15.10.2026 10:00 (CEST, UTC+2). */
  const now = () => vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));

  it("says „dzisiaj” for a moment earlier on the same Warsaw day", () => {
    now();
    expect(formatDayDistance("2026-10-15T07:59:00Z")).toBe("dzisiaj");
    // 00:30 on the 15th in Warsaw is still the 14th in UTC.
    expect(formatDayDistance("2026-10-14T22:30:00Z")).toBe("dzisiaj");
  });

  it("says „wczoraj” for the day before, however few hours ago it was", () => {
    now();
    // 22:41 on the 14th in Warsaw: under twelve hours ago, but yesterday -
    // the date printed above it says the 14th.
    expect(formatDayDistance("2026-10-14T20:41:00Z")).toBe("wczoraj");
    expect(formatDayDistance("2026-10-13T22:00:00Z")).toBe("wczoraj");
  });

  it("counts older moments in days", () => {
    now();
    expect(formatDayDistance("2026-10-12T08:00:00Z")).toBe("3 dni temu");
    expect(formatDayDistance("2026-10-10T08:00:00Z")).toBe("5 dni temu");
    expect(formatDayDistance("2026-09-23T08:00:00Z")).toBe("22 dni temu");
  });

  it("takes epoch milliseconds as well as an ISO string", () => {
    now();
    expect(formatDayDistance(Date.parse("2026-10-14T20:41:00Z"))).toBe(
      "wczoraj",
    );
  });

  // From 23:30 on 28.03 (CET) to 00:30 on 30.03 (CEST) is 24 hours - the
  // 29th had only 23 - but two calendar days.
  it("counts calendar days across the change to summer time", () => {
    vi.setSystemTime(new Date("2026-03-29T22:30:00Z"));
    expect(formatDayDistance("2026-03-28T22:30:00Z")).toBe("2 dni temu");
    expect(formatDayDistance("2026-03-29T00:30:00Z")).toBe("wczoraj");
  });

  // A moment a little in the future is a clock a little ahead, not a date
  // that has not happened yet.
  it("does not count a moment slightly ahead of the clock as a day away", () => {
    now();
    expect(formatDayDistance("2026-10-15T08:05:00Z")).toBe("dzisiaj");
  });

  it("prints a dash for a moment that is missing or unreadable", () => {
    now();
    expect(formatDayDistance(null)).toBe("—");
    expect(formatDayDistance(undefined)).toBe("—");
    expect(formatDayDistance("")).toBe("—");
    expect(formatDayDistance("nie data")).toBe("—");
  });
});

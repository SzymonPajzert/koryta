import { describe, it, expect } from "vitest";
import {
  countSearchDays,
  searchEnding,
  searchWeeks,
  summariseSearches,
  type SearchDay,
  type StoredSearch,
} from "../../shared/searchLog";

describe("summariseSearches", () => {
  const search = (fields: Partial<StoredSearch>): StoredSearch => ({
    query: "jan kowalski",
    results: 1,
    unverified: 0,
    outcome: "pick",
    signedIn: false,
    at: "2026-10-14T10:00:00.000Z",
    ...fields,
  });

  it("puts each query on one row with what its searches found", () => {
    const [row] = summariseSearches([
      search({ results: 0, outcome: "abandon" }),
      search({ results: 2, unverified: 2, at: "2026-10-14T12:00:00.000Z" }),
      search({ signedIn: true, outcome: "propose" }),
    ]);

    expect(row).toEqual({
      query: "jan kowalski",
      count: 3,
      signedOut: 2,
      noResults: 1,
      onlyUnverified: 1,
      picks: 1,
      proposes: 1,
      lastAt: "2026-10-14T12:00:00.000Z",
    });
  });

  it("lists the most searched first, then the most recent", () => {
    const rows = summariseSearches([
      search({ query: "rzadki", at: "2026-10-14T13:00:00.000Z" }),
      search({ query: "częsty" }),
      search({ query: "częsty" }),
      search({ query: "dawny", at: "2026-10-01T10:00:00.000Z" }),
    ]);

    expect(rows.map((row) => row.query)).toEqual(["częsty", "rzadki", "dawny"]);
  });
});

describe("searchEnding", () => {
  it("is a result opened for any pick, shortcuts with no hits among them", () => {
    expect(searchEnding({ outcome: "pick", results: 3 })).toBe("opened");
    expect(searchEnding({ outcome: "pick", results: 0 })).toBe("opened");
  });

  it("tells a search that found something from one that found nothing", () => {
    expect(searchEnding({ outcome: "abandon", results: 2 })).toBe("notOpened");
    expect(searchEnding({ outcome: "abandon", results: 0 })).toBe("nothing");
  });

  it("counts an offer to add by what the search had found", () => {
    expect(searchEnding({ outcome: "propose", results: 0 })).toBe("nothing");
    expect(searchEnding({ outcome: "propose", results: 4 })).toBe("notOpened");
  });
});

describe("countSearchDays", () => {
  const search = (fields: Partial<StoredSearch>): StoredSearch => ({
    query: "jan kowalski",
    results: 1,
    unverified: 0,
    outcome: "pick",
    signedIn: false,
    at: "2026-10-14T10:00:00.000Z",
    ...fields,
  });

  it("counts each day's searches by how they ended, the signed out apart", () => {
    const [day] = countSearchDays(
      [
        search({}),
        search({ signedIn: true }),
        search({ results: 0, outcome: "abandon", signedIn: true }),
        search({ results: 2, outcome: "abandon" }),
      ],
      ["2026-10-14"],
    );

    expect(day).toEqual({
      date: "2026-10-14",
      all: { opened: 2, notOpened: 1, nothing: 1 },
      signedOut: { opened: 1, notOpened: 1, nothing: 0 },
    });
  });

  it("keeps a quiet day as zeros, in the order given", () => {
    const days = countSearchDays(
      [search({ at: "2026-10-12T23:59:59.000Z" }), search({})],
      ["2026-10-12", "2026-10-13", "2026-10-14"],
    );

    expect(days.map((day) => [day.date, day.all.opened])).toEqual([
      ["2026-10-12", 1],
      ["2026-10-13", 0],
      ["2026-10-14", 1],
    ]);
  });

  it("leaves out a search from a day it was not asked for", () => {
    const [day] = countSearchDays(
      [search({ at: "2026-10-01T10:00:00.000Z" })],
      ["2026-10-14"],
    );
    expect(day!.all).toEqual({ opened: 0, notOpened: 0, nothing: 0 });
  });
});

describe("searchWeeks", () => {
  const day = (date: string, opened: number, nothing = 0): SearchDay => ({
    date,
    all: { opened, notOpened: 0, nothing },
    signedOut: { opened: 0, notOpened: 0, nothing },
  });

  it("adds the days up into weeks running Monday to Sunday", () => {
    // 2026-10-18 is a Sunday, 10-19 a Monday, 10-25 the Sunday after.
    const weeks = searchWeeks([
      day("2026-10-18", 1),
      day("2026-10-19", 2, 1),
      day("2026-10-21", 3),
      day("2026-10-25", 4),
      day("2026-10-26", 5),
    ]);

    expect(
      weeks.map((week) => [week.date, week.last, week.all.opened]),
    ).toEqual([
      ["2026-10-18", "2026-10-18", 1],
      ["2026-10-19", "2026-10-25", 9],
      ["2026-10-26", "2026-10-26", 5],
    ]);
    expect(weeks[1]!.signedOut).toEqual({
      opened: 0,
      notOpened: 0,
      nothing: 1,
    });
  });

  it("leaves the days it was given as they were", () => {
    const days = [day("2026-10-19", 2), day("2026-10-20", 3)];
    searchWeeks(days);
    expect(days[0]!.all.opened).toBe(2);
  });
});

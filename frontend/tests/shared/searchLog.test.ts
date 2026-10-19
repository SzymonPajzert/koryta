import { describe, it, expect } from "vitest";
import { summariseSearches, type StoredSearch } from "../../shared/searchLog";

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

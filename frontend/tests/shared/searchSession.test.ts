import { describe, it, expect } from "vitest";
import {
  SearchSession,
  normaliseQuery,
  settledSearchProps,
} from "../../shared/searchSession";

describe("normaliseQuery", () => {
  it("keeps what was asked, not how it was typed", () => {
    expect(normaliseQuery("  Jan   KOWALSKI ")).toBe("jan kowalski");
  });

  it("caps a query at a hundred characters", () => {
    expect(normaliseQuery("a".repeat(250))).toHaveLength(100);
  });
});

describe("SearchSession", () => {
  it("settles one search for a name typed in several requests", () => {
    // The box asks as the reader types; only the last query is the search.
    const session = new SearchSession();
    expect(session.results("jan", 20, 15)).toBeUndefined();
    expect(session.results("jan kow", 6, 5)).toBeUndefined();
    expect(session.results("jan kowalski", 2, 2)).toBeUndefined();

    expect(session.pick("person", true)).toEqual({
      query: "jan kowalski",
      results: 2,
      unverified: 2,
      outcome: "pick",
      picked: "person",
      pickedUnverified: true,
    });
    // Settled: nothing more to report for it.
    expect(session.abandon()).toBeUndefined();
  });

  it("keeps deleting back to a shorter query as the same search", () => {
    const session = new SearchSession();
    session.results("jan kowalski", 0, 0);
    expect(session.results("jan kowal", 1, 1)).toBeUndefined();
    expect(session.abandon()?.query).toBe("jan kowal");
  });

  it("settles the previous search as left when an unrelated one starts", () => {
    const session = new SearchSession();
    session.results("kowalski", 0, 0);
    expect(session.results("nowak", 3, 1)).toEqual({
      query: "kowalski",
      results: 0,
      unverified: 0,
      outcome: "abandon",
    });
  });

  it("settles a search the reader offered to add instead", () => {
    const session = new SearchSession();
    session.results("Anna Zielińska", 0, 0);
    expect(session.propose()).toEqual({
      query: "anna zielińska",
      results: 0,
      unverified: 0,
      outcome: "propose",
    });
  });

  it("does not report a query too short to be a search", () => {
    const session = new SearchSession();
    session.results("ko", 30, 10);
    expect(session.abandon()).toBeUndefined();
  });

  it("has nothing to report before any answer came back", () => {
    expect(new SearchSession().pick("party", false)).toBeUndefined();
  });

  describe("when a pick beats the answer", () => {
    it("settles the search once the answer is in", () => {
      // A party is on the menu before anything has come back. With no answer
      // for the pick to settle, the search used to go on no record at all.
      const session = new SearchSession();
      expect(session.pick("party", false, "Konfederacja")).toBeUndefined();

      expect(session.lateAnswer("konfederacja", 3, 1)).toEqual({
        query: "konfederacja",
        results: 3,
        unverified: 1,
        outcome: "pick",
        picked: "party",
        pickedUnverified: false,
      });
      // Settled: nothing more to report for it.
      expect(session.lateAnswer("konfederacja", 3, 1)).toBeUndefined();
      expect(session.abandon()).toBeUndefined();
    });

    it("waits as well when all that came back was too short to report", () => {
      const session = new SearchSession();
      session.results("ko", 30, 10);
      expect(session.pick("party", false, "kon")).toBeUndefined();
      expect(session.lateAnswer("kon", 8, 0)?.query).toBe("kon");
    });

    it("does not wait when an earlier answer gave it a search to settle", () => {
      const session = new SearchSession();
      session.results("kon", 8, 0);
      expect(session.pick("party", false, "konfederacja")?.query).toBe("kon");
      expect(session.lateAnswer("konfederacja", 1, 0)).toBeUndefined();
    });

    it("takes only the answer it beat", () => {
      const session = new SearchSession();
      session.pick("party", false, "konfederacja");
      expect(session.lateAnswer("kon", 8, 0)).toBeUndefined();
      expect(session.lateAnswer("konfederacja", 1, 0)?.outcome).toBe("pick");
    });

    it("leaves the search typed after it alone", () => {
      const session = new SearchSession();
      session.pick("party", false, "konfederacja");
      expect(session.results("anna", 1, 0)).toBeUndefined();
      expect(session.lateAnswer("konfederacja", 1, 0)?.query).toBe(
        "konfederacja",
      );
      expect(session.abandon()?.query).toBe("anna");
    });
  });

  it("has no use for a late answer no pick is waiting for", () => {
    // The answer to a query typed over, or a pick made from an empty box with
    // nothing out: neither may turn into a search.
    const session = new SearchSession();
    session.pick("list", false);
    expect(session.lateAnswer("jan", 2, 2)).toBeUndefined();

    session.results("jan kowalski", 1, 1);
    expect(session.lateAnswer("jan", 2, 2)).toBeUndefined();
    expect(session.abandon()?.query).toBe("jan kowalski");
  });
});

describe("settledSearchProps", () => {
  it("buckets the counts as search:performed does", () => {
    expect(
      settledSearchProps({
        query: "jan kowalski",
        results: 2,
        unverified: 2,
        outcome: "pick",
      }),
    ).toEqual({
      query: "jan kowalski",
      results: "1-4",
      unverified: "all",
      outcome: "pick",
    });
    expect(
      settledSearchProps({
        query: "zofia zielińska",
        results: 0,
        unverified: 0,
        outcome: "abandon",
      }),
    ).toEqual({
      query: "zofia zielińska",
      results: "none",
      unverified: "none",
      outcome: "abandon",
    });
  });

  it("leaves out what was opened, which search:pick already says", () => {
    expect(
      settledSearchProps({
        query: "jan kowalski",
        results: 1,
        unverified: 1,
        outcome: "pick",
        picked: "person",
        pickedUnverified: true,
      }),
    ).toEqual({
      query: "jan kowalski",
      results: "1-4",
      unverified: "all",
      outcome: "pick",
    });
  });
});

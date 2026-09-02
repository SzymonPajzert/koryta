import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_GOALS,
  GOALS,
  SEARCH_PICK_KINDS,
  TABELA_FILTER_NAMES,
  activeTabelaFilters,
  isPassiveGoal,
  resultBucket,
  searchPickKind,
  tabelaFiltersChanged,
} from "../../shared/analytics";

/** A goal Plausible has not been told about is recorded and then invisible, so
 * the checks here are about the list staying something one can paste into the
 * dashboard: every name described, every name well formed, and every property
 * declared where the type checker can hold the call sites to it. */
describe("the goal vocabulary", () => {
  it("describes every goal", () => {
    for (const goal of ALL_GOALS) {
      // A description that only restates the name tells the person reading the
      // dashboard in six months nothing they did not already have.
      expect(GOALS[goal].description.length, goal).toBeGreaterThan(20);
    }
  });

  it("names every goal <surface>:<what happened>", () => {
    for (const goal of ALL_GOALS) {
      expect(goal, goal).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
    }
  });

  it("names every property in a form Plausible can group by", () => {
    for (const goal of ALL_GOALS) {
      for (const prop of GOALS[goal].props) {
        expect(prop, `${goal}.${prop}`).toMatch(/^[a-z][a-z0-9-]*$/);
      }
      // Plausible caps an event at 30 properties; anything near that is a log
      // line rather than a dimension.
      expect(GOALS[goal].props.length, goal).toBeLessThanOrEqual(4);
    }
  });

  it("stays small enough to register by hand", () => {
    // Not a law of nature, but a tripwire: goals are created one at a time in
    // the dashboard by hand, and the moment this list is tedious to set up,
    // somebody has spelled a dimension into a name that belongs in a property.
    expect(ALL_GOALS.length).toBeLessThan(30);
  });

  it("marks exactly the goals that fire without a reader doing anything", () => {
    // The consequence of getting this wrong is quiet and total: an interactive
    // event on mount un-bounces every visitor, and the bounce rate - which is
    // the number `tabela:open` exists to explain - goes to zero.
    const passive = ALL_GOALS.filter(isPassiveGoal).sort();
    expect(passive).toEqual([
      "experiment:assigned",
      "tabela:no-results",
      "tabela:open",
    ]);
  });
});

describe("searchPickKind", () => {
  it("maps the three types /api/search returns", () => {
    expect(searchPickKind("person")).toBe("person");
    expect(searchPickKind("place")).toBe("place");
    expect(searchPickKind("region")).toBe("region");
  });

  it("files anything unexpected as a place rather than throwing", () => {
    // The type arrives over the wire; a document with a stray one should still
    // land under some kind instead of breaking the search box.
    expect(searchPickKind("topic")).toBe("place");
    expect(searchPickKind(undefined)).toBe("place");
    expect(searchPickKind("")).toBe("place");
  });

  it("only ever returns a kind the vocabulary knows", () => {
    for (const type of ["person", "place", "region", "topic", "nonsense"]) {
      expect(SEARCH_PICK_KINDS).toContain(searchPickKind(type));
    }
  });
});

describe("resultBucket", () => {
  it("separates nothing from something", () => {
    expect(resultBucket(0)).toBe("none");
    expect(resultBucket(1)).toBe("1-4");
  });

  it("buckets rather than counts", () => {
    // The query is not recorded, so this is the only thing that says whether a
    // search worked - it has to read as a breakdown, not as a list.
    const buckets = new Set(
      Array.from({ length: 500 }, (_, i) => resultBucket(i)),
    );
    expect(buckets.size).toBeLessThanOrEqual(4);
  });
});

describe("activeTabelaFilters", () => {
  it("finds nothing in a bare or table-only query", () => {
    expect(activeTabelaFilters({})).toEqual([]);
    // Paging and sorting are the table's own state, not filters - a reader on
    // page three of the unfiltered list arrived cold.
    expect(
      activeTabelaFilters({ page: "3", sortBy: "name", itemsPerPage: "50" }),
    ).toEqual([]);
  });

  it("reads a filter however the router spelled it", () => {
    expect(activeTabelaFilters({ party: "PiS" })).toEqual(["party"]);
    expect(activeTabelaFilters({ party: ["PiS", "PO"] })).toEqual(["party"]);
  });

  it("treats an emptied filter as absent", () => {
    // stringFilter leaves a cleared text filter as "", and a multi-select
    // emptied down to nothing does the same. Counting those would report every
    // reader who cleared a chip as still filtering.
    expect(activeTabelaFilters({ teryt: "" })).toEqual([]);
    expect(activeTabelaFilters({ party: [] })).toEqual([]);
    expect(activeTabelaFilters({ party: [null] })).toEqual([]);
  });

  it("reports the spellings older links carry under the current name", () => {
    expect(activeTabelaFilters({ parties: "PiS" })).toEqual(["party"]);
    expect(activeTabelaFilters({ krs: "123" })).toEqual(["company"]);
    // Both spellings of one filter are one filter.
    expect(activeTabelaFilters({ krs: "123", place: "abc" })).toEqual([
      "company",
    ]);
  });
});

describe("tabelaFiltersChanged", () => {
  it("says nothing changed when nothing did", () => {
    expect(tabelaFiltersChanged({ party: "PiS" }, { party: "PiS" })).toEqual(
      [],
    );
    // A single value and a one-element list are the same filter; which one the
    // router produces depends on how the url was written.
    expect(tabelaFiltersChanged({ party: "PiS" }, { party: ["PiS"] })).toEqual(
      [],
    );
  });

  it("ignores paging and sorting", () => {
    expect(
      tabelaFiltersChanged({ page: "1" }, { page: "2", sortBy: "name" }),
    ).toEqual([]);
  });

  it("counts setting, changing and clearing a filter", () => {
    expect(tabelaFiltersChanged({}, { party: "PiS" })).toEqual(["party"]);
    expect(tabelaFiltersChanged({ party: "PiS" }, { party: "PO" })).toEqual([
      "party",
    ]);
    // Dropping the one chip is still using the party filter - which is why
    // „Wyczyść” is reported by the page instead of through here.
    expect(tabelaFiltersChanged({ party: "PiS" }, {})).toEqual(["party"]);
  });

  it("reports one filter when two parameters name it", () => {
    // Picking an employer on a page reached by an old ?krs= link rewrites both
    // parameters, and it is one thing the reader did.
    expect(tabelaFiltersChanged({ krs: "123" }, { place: "abc" })).toEqual([
      "company",
    ]);
  });

  it("keeps the filters a property can tell apart separate", () => {
    // On a Business plan there is no reason to group these: `filter` is a
    // property, so eleven values cost exactly as much as three.
    expect(
      tabelaFiltersChanged(
        {},
        { currentlyEmployed: "selected", minEmploymentDate: "2023-01-01" },
      ),
    ).toEqual(["currently-employed", "employed-since"]);
    expect(
      tabelaFiltersChanged(
        {},
        { visibility: "private", hideVoted: "no_votes", minVotes: "3" },
      ),
    ).toEqual(["min-votes", "visibility", "voted"]);
  });

  it("reports each distinct filter of a multi-filter change", () => {
    expect(tabelaFiltersChanged({}, { party: "PiS", teryt: "1261" })).toEqual([
      "party",
      "region",
    ]);
  });
});

describe("the tabela filter map", () => {
  it("covers every filter the page clears", () => {
    // The silent failure this catches: a filter is added to the bar, the reader
    // uses it, and nothing is recorded because nobody remembered this map.
    // `clearFilters` is the one list in the page that has to name every filter
    // parameter, so it is the thing to compare against.
    //
    // From `process.cwd()` rather than `import.meta.url`: under the Nuxt test
    // environment a module's url is served by vite over http, and
    // `fileURLToPath` rejects it. Both candidates are tried because the suite
    // is run from `frontend/` and occasionally from the repo root.
    const candidates = [
      resolve(process.cwd(), "app/pages/eksploruj/tabela.vue"),
      resolve(process.cwd(), "frontend/app/pages/eksploruj/tabela.vue"),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    expect(found, `tabela.vue not found from ${process.cwd()}`).toBeTruthy();
    const page = readFileSync(found!, "utf8");

    const cleared = page
      .split("const clearFilters = () => {")[1]!
      .split("};")[0]!;
    const keys = [...cleared.matchAll(/^\s{4}(\w+): undefined,$/gm)].map(
      (match) => match[1]!,
    );

    // Sanity: if the shape of clearFilters changes enough that nothing parses,
    // this test would pass by finding nothing to check.
    expect(keys.length).toBeGreaterThan(8);

    for (const key of keys) {
      // `page` is the table's own state; clearFilters resets it along with the
      // filters because a narrower list has fewer pages.
      if (key === "page") continue;
      expect(Object.keys(TABELA_FILTER_NAMES), key).toContain(key);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  ALL_GOALS,
  GOAL_DESCRIPTIONS,
  SEARCH_PICK_GOALS,
  SEARCH_PROPOSE_GOALS,
  searchPickKind,
} from "../../shared/analytics";
import { EXPERIMENT_GOALS } from "../../shared/experiments";

/** A goal Plausible has not been told about is recorded and then invisible, so
 * the checks here are about the list staying something one can paste into the
 * dashboard: every name described, every name unique, and no name carrying a
 * dimension with more values than a goal list can hold. */
describe("the goal vocabulary", () => {
  it("describes every goal", () => {
    for (const goal of ALL_GOALS) {
      expect(GOAL_DESCRIPTIONS[goal], goal).toBeTruthy();
      // A description that only restates the name tells the person reading the
      // dashboard in six months nothing they did not already have.
      expect(GOAL_DESCRIPTIONS[goal].length, goal).toBeGreaterThan(20);
    }
  });

  it("names every goal <surface>:<what happened>", () => {
    for (const goal of ALL_GOALS) {
      expect(goal, goal).toMatch(/^[a-z0-9-]+:[a-z0-9-]+$/);
    }
  });

  it("stays small enough to register by hand", () => {
    // Not a law of nature, but a tripwire: the moment this list is long enough
    // to be tedious to set up, somebody has put a high-cardinality dimension in
    // a name and the Growth-plan reasoning in shared/analytics.ts has been
    // forgotten. Raise it deliberately, not to make a red test green.
    expect(ALL_GOALS.length + EXPERIMENT_GOALS.length).toBeLessThan(40);
  });

  it("does not collide with an experiment marker", () => {
    for (const goal of EXPERIMENT_GOALS) {
      expect(ALL_GOALS).not.toContain(goal);
    }
  });

  it("points every search goal at a registered name", () => {
    for (const goal of [
      ...Object.values(SEARCH_PICK_GOALS),
      ...Object.values(SEARCH_PROPOSE_GOALS),
    ]) {
      expect(ALL_GOALS).toContain(goal);
    }
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
    // land under some goal instead of breaking the search box.
    expect(searchPickKind("topic")).toBe("place");
    expect(searchPickKind(undefined)).toBe("place");
    expect(searchPickKind("")).toBe("place");
  });
});

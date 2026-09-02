import { describe, it, expect } from "vitest";
import {
  EXPERIMENTS,
  EXPERIMENT_GOALS,
  HOME_DEFAULT_EXPERIMENT,
  assignArm,
  experimentGoal,
  hashToUnitInterval,
  type Experiment,
} from "../../shared/experiments";

const evenSplit: Experiment<"a" | "b" | "c"> = {
  id: "test",
  question: "does the split split?",
  arms: [
    { id: "a", weight: 1, description: "a" },
    { id: "b", weight: 1, description: "b" },
    { id: "c", weight: 1, description: "c" },
  ],
};

const ids = Array.from({ length: 6000 }, (_, i) => `session-${i}`);

describe("hashToUnitInterval", () => {
  it("stays inside [0, 1)", () => {
    for (const id of ids) {
      const value = hashToUnitInterval(id);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is stable for the same input", () => {
    expect(hashToUnitInterval("session-1")).toBe(
      hashToUnitInterval("session-1"),
    );
  });

  it("spreads across the interval", () => {
    // The failure this guards against is the sign bit: without `>>> 0` half of
    // the inputs come out negative, every one of them lands in the first arm,
    // and the experiment silently stops being an experiment.
    const halves = ids.filter((id) => hashToUnitInterval(id) < 0.5).length;
    expect(halves / ids.length).toBeGreaterThan(0.4);
    expect(halves / ids.length).toBeLessThan(0.6);
  });
});

describe("assignArm", () => {
  it("is stable for the same session", () => {
    for (const id of ids.slice(0, 50)) {
      expect(assignArm(evenSplit, id)).toBe(assignArm(evenSplit, id));
    }
  });

  it("honours the weights", () => {
    const counts = { a: 0, b: 0, c: 0 };
    for (const id of ids) counts[assignArm(evenSplit, id)]++;
    for (const arm of ["a", "b", "c"] as const) {
      expect(counts[arm] / ids.length, arm).toBeGreaterThan(0.28);
      expect(counts[arm] / ids.length, arm).toBeLessThan(0.39);
    }
  });

  it("never assigns a zero-weight arm", () => {
    const oneLive: Experiment<"a" | "b"> = {
      id: "test",
      question: "",
      arms: [
        { id: "a", weight: 1, description: "a" },
        { id: "b", weight: 0, description: "b" },
      ],
    };
    for (const id of ids) expect(assignArm(oneLive, id)).toBe("a");
  });

  it("falls back to the control when every weight is zero", () => {
    const dead: Experiment<"a" | "b"> = {
      id: "test",
      question: "",
      arms: [
        { id: "a", weight: 0, description: "a" },
        { id: "b", weight: 0, description: "b" },
      ],
    };
    expect(assignArm(dead, "session-1")).toBe("a");
  });

  it("assigns independently per experiment", () => {
    // The session id is one value for the whole site, so two experiments would
    // put the same readers in the same-numbered arm if the experiment id were
    // not hashed in with it - which quietly turns two experiments into one.
    const other: Experiment<"a" | "b" | "c"> = { ...evenSplit, id: "other" };
    const differing = ids.filter(
      (id) => assignArm(evenSplit, id) !== assignArm(other, id),
    ).length;
    expect(differing / ids.length).toBeGreaterThan(0.5);
  });
});

describe("the registry", () => {
  it("ships dormant", () => {
    // The guard on accidentally deploying a live split. Activating an
    // experiment means changing this test in the same commit, which is where
    // the decision gets reviewed.
    for (const experiment of Object.values(EXPERIMENTS)) {
      const live = experiment.arms.filter((arm) => arm.weight > 0);
      expect(
        live.map((arm) => arm.id),
        experiment.id,
      ).toEqual([experiment.arms[0]!.id]);
    }
  });

  it("keys each experiment by its own id", () => {
    for (const [key, experiment] of Object.entries(EXPERIMENTS)) {
      expect(experiment.id).toBe(key);
    }
  });

  it("registers a marker goal for every arm, including dormant ones", () => {
    for (const experiment of Object.values(EXPERIMENTS)) {
      for (const arm of experiment.arms) {
        expect(EXPERIMENT_GOALS).toContain(
          experimentGoal(experiment.id, arm.id),
        );
      }
    }
  });

  it("keeps the home arms the panels the explorer can render", () => {
    // `gry` is declared for the games hub on another branch, so this is the
    // reminder that HomeExplorer only implements two of the three.
    expect(HOME_DEFAULT_EXPERIMENT.arms.map((arm) => arm.id)).toEqual([
      "map",
      "parties",
      "gry",
    ]);
  });
});

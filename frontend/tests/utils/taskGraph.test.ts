// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  TASK_NODE_HEIGHT,
  TASK_NODE_WIDTH,
  foldSizes,
  foldTasks,
  placeTasks,
  terminalTasks,
} from "../../app/utils/taskGraph";

describe("placeTasks", () => {
  it("puts what has to happen first to the left of what waits on it", () => {
    const { positions, isolated, gridTop } = placeTasks(
      ["merge", "deploy", "upload"],
      [
        ["merge", "deploy"],
        ["deploy", "upload"],
      ],
    );
    const x = (id: string) => positions.get(id)!.x;
    expect(x("merge")).toBeLessThan(x("deploy"));
    expect(x("deploy")).toBeLessThan(x("upload"));
    expect(x("deploy") - x("merge")).toBeGreaterThanOrEqual(TASK_NODE_WIDTH);
    expect(isolated).toEqual([]);
    expect(gridTop).toBeNull();
  });

  it("puts tasks joined to nothing in a grid under the flow", () => {
    const { positions, isolated, gridTop } = placeTasks(
      ["a", "b", "loose-1", "loose-2"],
      [["a", "b"]],
    );
    expect(isolated).toEqual(["loose-1", "loose-2"]);
    const flowBottom = Math.max(positions.get("a")!.y, positions.get("b")!.y);
    expect(gridTop).toBeGreaterThan(flowBottom + TASK_NODE_HEIGHT);
    expect(positions.get("loose-1")).toEqual({ x: 0, y: gridTop });
    expect(positions.get("loose-2")!.y).toBe(gridTop);
    expect(positions.get("loose-2")!.x).toBeGreaterThan(TASK_NODE_WIDTH);
  });

  it("keeps a folded card with no arrow left out of the loose ones", () => {
    const { isolated } = placeTasks(
      ["stack", "loose", "a", "b"],
      [["a", "b"]],
      new Set(["stack"]),
    );
    expect(isolated).toEqual(["loose"]);
  });

  it("ignores dependencies on tasks that are not shown", () => {
    const { isolated } = placeTasks(["a"], [["hidden", "a"]]);
    expect(isolated).toEqual(["a"]);
  });

  it("packs separate chains side by side rather than in one tall column", () => {
    const ids: string[] = [];
    const edges: [string, string][] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(`a${i}`, `b${i}`);
      edges.push([`a${i}`, `b${i}`]);
    }
    const { positions } = placeTasks(ids, edges);
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    const width = Math.max(...xs) + TASK_NODE_WIDTH;
    const height = Math.max(...ys) + TASK_NODE_HEIGHT;
    // Twelve chains stacked would be twelve cards tall and two wide.
    expect(height).toBeLessThan(6 * TASK_NODE_HEIGHT * 2);
    expect(width).toBeGreaterThan(2 * 2 * TASK_NODE_WIDTH);
    // Each chain still reads left to right.
    for (let i = 0; i < 12; i++) {
      expect(positions.get(`a${i}`)!.x).toBeLessThan(positions.get(`b${i}`)!.x);
      expect(positions.get(`a${i}`)!.y).toBe(positions.get(`b${i}`)!.y);
    }
  });

  it("puts the biggest chain first", () => {
    const { positions } = placeTasks(
      ["s1", "s2", "l1", "l2", "l3"],
      [
        ["s1", "s2"],
        ["l1", "l2"],
        ["l2", "l3"],
      ],
    );
    expect(positions.get("l1")).toEqual({ x: 0, y: 0 });
  });

  it("lays out the same list the same way every time", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const edges = [
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ] as const;
    expect([...placeTasks(ids, edges).positions]).toEqual([
      ...placeTasks(ids, edges).positions,
    ]);
  });
});

describe("foldTasks", () => {
  // a → b → c ← d: everything leads to c alone.
  const ids = ["a", "b", "c", "d"];
  const edges = [
    ["a", "b"],
    ["b", "c"],
    ["d", "c"],
  ] as const;

  it("folds a task with everything that leads only to it", () => {
    const folds = foldTasks(ids, edges, new Set(["c"]));
    expect(folds.ids).toEqual(["c"]);
    expect(folds.stacks).toEqual(new Map([["c", 3]]));
    expect([...folds.hiddenIn.keys()].sort()).toEqual(["a", "b", "d"]);
    expect(folds.edges).toEqual([]);
  });

  it("leaves out what also leads elsewhere, and what leads to that", () => {
    // x → a → b → c, and a → e as well: only b leads to c alone.
    const folds = foldTasks(
      ["x", "a", "b", "c", "e"],
      [
        ["x", "a"],
        ["a", "b"],
        ["b", "c"],
        ["a", "e"],
      ],
      new Set(["c"]),
    );
    expect(folds.ids).toEqual(["x", "a", "c", "e"]);
    expect(folds.stacks).toEqual(new Map([["c", 1]]));
    // The arrow into b now lands on the card b is folded into.
    expect(folds.edges).toContainEqual({
      source: "a",
      target: "c",
      pairs: [["a", "b"]],
    });
    expect(folds.edges).toContainEqual({
      source: "x",
      target: "a",
      pairs: [["x", "a"]],
    });
  });

  it("hides a fold inside a bigger one, and shows it again on its own", () => {
    const both = foldTasks(ids, edges, new Set(["b", "c"]));
    expect(both.stacks).toEqual(new Map([["c", 3]]));
    expect(both.groups.get("b")).toEqual(["a"]);
    const inner = foldTasks(ids, edges, new Set(["b"]));
    expect(inner.stacks).toEqual(new Map([["b", 1]]));
    expect(inner.ids).toEqual(["b", "c", "d"]);
    expect(inner.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "b->c",
      "d->c",
    ]);
  });

  it("does nothing for a task that nothing leads to alone", () => {
    const folds = foldTasks(ids, edges, new Set(["a", "gone"]));
    expect(folds.ids).toEqual(ids);
    expect(folds.stacks.size).toBe(0);
  });

  it("says how much each task would fold, and which end the chains", () => {
    expect(foldSizes(ids, edges)).toEqual(
      new Map([
        ["a", 0],
        ["b", 1],
        ["c", 3],
        ["d", 0],
      ]),
    );
    expect(terminalTasks([...ids, "loose"], edges)).toEqual(["c", "loose"]);
  });
});

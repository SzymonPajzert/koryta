// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  TASK_NODE_HEIGHT,
  TASK_NODE_WIDTH,
  placeTasks,
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

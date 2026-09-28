// @vitest-environment node
import { describe, it, expect } from "vitest";
import { importTasks, planImport } from "../../scripts/ops/import-tasks";
import type { TaskStore } from "../../scripts/mcp/ops-store";
import type { Task } from "../../shared/tasks";

const NOW = "2026-09-28T09:00:00.000Z";

function stored(id: string, dependsOn: string[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn,
    tags: [],
    links: [],
    branches: [],
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "owner",
    log: [],
  };
}

function memoryStore(initial: Task[]) {
  const docs = new Map<string, Task>(initial.map((task) => [task.id, task]));
  const store: TaskStore = {
    source: "memory",
    list: async () => [...docs.values()],
    async create(task) {
      if (docs.has(task.id)) return false;
      docs.set(task.id, task);
      return true;
    },
    transaction: async () => {
      throw new Error("the importer writes task by task");
    },
  };
  return { store, docs };
}

describe("planImport", () => {
  it("writes what is new, leaves what is there, and lets the file refer to itself", () => {
    const plan = planImport(
      [
        { id: "merge-x", title: "Merge x" },
        { id: "deploy-x", title: "Deploy x", dependsOn: ["merge-x", "old"] },
        { id: "old", title: "Already there" },
      ],
      [stored("old")],
      "agent:import",
      NOW,
    );
    expect(plan.toWrite.map((t) => t.id)).toEqual(["merge-x", "deploy-x"]);
    expect(plan.existing).toEqual(["old"]);
    expect(plan.toWrite[1]).toMatchObject({
      dependsOn: ["merge-x", "old"],
      createdBy: "agent:import",
      createdAt: NOW,
    });
  });

  it("refuses the whole file for one bad task", () => {
    expect(() => planImport([{ title: "no id" }], [], "agent", NOW)).toThrow(
      /Task #1.*id/,
    );
    expect(() =>
      planImport(
        [
          { id: "a", title: "A" },
          { id: "a", title: "A again" },
        ],
        [],
        "agent",
        NOW,
      ),
    ).toThrow("Ids given twice: a.");
    expect(() =>
      planImport(
        [{ id: "a", title: "A", dependsOn: ["nope"] }],
        [],
        "agent",
        NOW,
      ),
    ).toThrow("a depends on unknown tasks: nope.");
  });

  it("refuses a loop, including one through a task already on the list", () => {
    expect(() =>
      planImport(
        [{ id: "a", title: "A", dependsOn: ["b"] }],
        [stored("b", ["a"])],
        "agent",
        NOW,
      ),
    ).toThrow(/A loop: a → b → a/);
  });
});

describe("importTasks", () => {
  const file = [
    { id: "merge-x", title: "Merge x" },
    { id: "deploy-x", title: "Deploy x", dependsOn: ["merge-x"] },
  ];

  it("only reports on a dry run", async () => {
    const { store, docs } = memoryStore([]);
    const lines = await importTasks(store, file, { commit: false, now: NOW });
    expect(lines.at(-1)).toBe(
      "Dry run: would write 2. Run again with --commit.",
    );
    expect(docs.size).toBe(0);
  });

  it("writes on --commit, and a second run adds nothing", async () => {
    const { store, docs } = memoryStore([]);
    await importTasks(store, file, { commit: true, now: NOW });
    expect([...docs.keys()]).toEqual(["merge-x", "deploy-x"]);
    const again = await importTasks(store, file, { commit: true, now: NOW });
    expect(again).toContain("Wrote 0.");
  });
});

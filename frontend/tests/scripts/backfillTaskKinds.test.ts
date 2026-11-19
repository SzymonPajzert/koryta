// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  commitPlan,
  planDecisions,
  planMerges,
} from "../../scripts/ops/backfill-task-kinds";
import type { TaskStore } from "../../scripts/mcp/ops-store";
import type { Task } from "../../shared/tasks";

const READ = "2026-11-19T09:00:00.000Z";
const NOW = "2026-11-19T20:00:00.000Z";

function stored(id: string, title: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    title,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: READ,
    updatedAt: READ,
    createdBy: "owner",
    log: [],
    ...extra,
  };
}

function memoryStore(initial: Task[]) {
  const docs = new Map(initial.map((task) => [task.id, task]));
  const store: TaskStore = {
    source: "memory",
    list: async () => [...docs.values()],
    create: async () => false,
    async transaction(work) {
      const queued: Task[] = [];
      const result = await work([...docs.values()], {
        create: (task) => queued.push(task),
        replace: (task) => queued.push(task),
      });
      for (const task of queued) docs.set(task.id, task);
      return result;
    },
  };
  return { store, docs };
}

describe("planMerges", () => {
  const remote = new Set(["named-branch", "id-branch"]);

  it("makes branch merges kind merge and leaves page merges as actions", () => {
    const plan = planMerges(
      [
        stored("merge-a", "Merge a", { branches: ["a"] }),
        stored("merge-b", "Merge named-branch: does b"),
        stored(
          "merge-id-branch",
          "Merge id-branch once its baselines are retaken",
        ),
        stored("merge-c", "Review and merge the slates night step"),
        stored("merge-twins", "Merge the 14 draft twins into their pages"),
        stored("merge-done", "Merge done", { status: "done", branches: ["d"] }),
        stored("merge-task", "Merge something", { kind: "task" }),
      ],
      remote,
    );
    expect(Object.fromEntries(plan.map((c) => [c.id, c.patch]))).toEqual({
      "merge-a": { kind: "merge", note: "Rodzaj: Merge." },
      "merge-b": {
        kind: "merge",
        branches: ["named-branch"],
        note: "Rodzaj: Merge, gałąź named-branch z tytułu.",
      },
      "merge-id-branch": {
        kind: "merge",
        branches: ["id-branch"],
        note: "Rodzaj: Merge, gałąź id-branch z tytułu.",
      },
      "merge-c": {
        kind: "merge",
        note: "Rodzaj: Merge. Brak gałęzi: dopisz ją w polu Gałęzie.",
      },
    });
  });
});

describe("planDecisions", () => {
  it("writes question, options and recommendation, never a pick", () => {
    const tasks = [
      stored("decide-a", "A?", { kind: "decision" }),
      stored("decide-b", "B?", { kind: "decision" }),
      stored("decide-set", "Set?", { kind: "decision", question: "Asked" }),
    ];
    const { changes, problems } = planDecisions(tasks, [
      {
        id: "decide-a",
        question: "Which?",
        options: [
          { key: "A", title: "One" },
          { key: "B", title: "Two" },
        ],
        recommended: "B",
      },
      {
        id: "decide-b",
        question: "Only a question",
        options: [],
        recommended: "A",
      },
      { id: "decide-set", question: "Again" },
      { id: "missing", question: "?" },
    ]);
    expect(changes.map((c) => [c.id, c.patch])).toEqual([
      [
        "decide-a",
        {
          question: "Which?",
          options: [
            { key: "A", title: "One" },
            { key: "B", title: "Two" },
          ],
          recommended: "B",
        },
      ],
      ["decide-b", { question: "Only a question" }],
    ]);
    expect(problems).toHaveLength(2);
  });
});

describe("commitPlan", () => {
  it("writes the plan and skips a task changed since the dry run", async () => {
    const { store, docs } = memoryStore([
      stored("merge-a", "Merge a", { branches: ["a"] }),
      stored("merge-b", "Merge b", { branches: ["b"], updatedAt: NOW }),
    ]);
    const result = await commitPlan(
      store,
      [
        {
          id: "merge-a",
          title: "",
          updatedAt: READ,
          patch: { kind: "merge", note: "Rodzaj: Merge." },
        },
        { id: "merge-b", title: "", updatedAt: READ, patch: { kind: "merge" } },
      ],
      "agent:backfill-task-kinds",
      NOW,
    );
    expect(result).toEqual({ written: ["merge-a"], skipped: ["merge-b"] });
    expect(docs.get("merge-a")).toMatchObject({
      kind: "merge",
      updatedAt: NOW,
    });
    expect(docs.get("merge-a")!.log.at(-1)!.text).toBe("Rodzaj: Merge.");
    expect(docs.get("merge-b")!.kind).toBe("action");
  });
});

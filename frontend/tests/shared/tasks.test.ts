// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  LOG_KEEP,
  applyTaskPatch,
  compareNewest,
  compareTasks,
  dependencyChange,
  dependencyCycle,
  dependencyProblem,
  foldWords,
  goalProgress,
  newTask,
  patchedDependsOn,
  similarTasks,
  taskAncestors,
  taskCreateSchema,
  taskEditPatch,
  taskPatchSchema,
  taskSection,
  taskSlug,
  taskStates,
  taskUrl,
  uniqueTaskId,
  type Task,
} from "../../shared/tasks";

const T0 = "2026-09-28T08:00:00.000Z";
const T1 = "2026-09-28T09:00:00.000Z";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    body: "",
    kind: "action",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: [],
    createdAt: T0,
    updatedAt: T0,
    createdBy: "agent",
    log: [],
    ...fields,
  };
}

describe("taskSlug", () => {
  it("folds Polish letters rather than dropping them", () => {
    expect(foldWords("Łódź, Żółć i Ślęża")).toEqual([
      "lodz",
      "zolc",
      "i",
      "sleza",
    ]);
    expect(taskSlug("Wdróż indeksy po scaleniu gałęzi")).toBe(
      "wdroz-indeksy-po-scaleniu-galezi",
    );
  });

  it("cuts at a word, and never returns an empty id", () => {
    const slug = taskSlug(
      "Deploy the seven composite Firestore indexes the umowy contracts feature needs",
      40,
    );
    expect(slug).toBe("deploy-the-seven-composite-firestore");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(taskSlug("!!!")).toBe("zadanie");
  });

  it("numbers a taken id", () => {
    expect(uniqueTaskId("deploy-rules", new Set())).toBe("deploy-rules");
    expect(
      uniqueTaskId("deploy-rules", new Set(["deploy-rules", "deploy-rules-2"])),
    ).toBe("deploy-rules-3");
  });
});

describe("taskStates", () => {
  it("is ready once everything it waits for is closed", () => {
    const tasks = [
      task("merge", { status: "done" }),
      task("deploy", { dependsOn: ["merge"] }),
      task("upload", { dependsOn: ["deploy"] }),
    ];
    const states = taskStates(tasks);
    expect(states.get("deploy")!.readiness).toBe("ready");
    expect(states.get("upload")!.readiness).toBe("blocked");
    expect(states.get("upload")!.blockers.map((t) => t.id)).toEqual(["deploy"]);
    expect(states.get("deploy")!.dependents.map((t) => t.id)).toEqual([
      "upload",
    ]);
  });

  it("is not held up by a dropped dependency, or by one that does not exist", () => {
    const states = taskStates([
      task("gone", { status: "dropped" }),
      task("after", { dependsOn: ["gone", "never-was"] }),
    ]);
    expect(states.get("after")!.readiness).toBe("ready");
    expect(states.get("after")!.missing).toEqual(["never-was"]);
  });

  it("keeps parked and closed apart from readiness", () => {
    const states = taskStates([
      task("open-dep"),
      task("parked", { status: "parked", dependsOn: ["open-dep"] }),
      task("done", { status: "done", dependsOn: ["open-dep"] }),
    ]);
    expect(states.get("parked")!.readiness).toBe("parked");
    expect(states.get("done")!.readiness).toBe("closed");
  });
});

describe("dependencies", () => {
  const chain = [
    task("a"),
    task("b", { dependsOn: ["a"] }),
    task("c", { dependsOn: ["b"] }),
  ];

  it("finds the loop a new dependency would close", () => {
    expect(dependencyCycle(chain, "a", ["c"])).toEqual(["a", "c", "b", "a"]);
    expect(dependencyCycle(chain, "c", ["a"])).toBeNull();
  });

  it("explains what is wrong with a dependency list", () => {
    expect(dependencyProblem(chain, "a", ["a"])).toMatch(/siebie/);
    expect(dependencyProblem(chain, "a", ["zzz"])).toMatch(/zzz/);
    expect(dependencyProblem(chain, "a", ["c"])).toMatch(/a → c → b → a/);
    expect(dependencyProblem(chain, "c", ["a", "b"])).toBeNull();
  });

  it("judges only what is added, so a stale dependency blocks no other edit", () => {
    expect(dependencyProblem(chain, "c", ["gone", "a"], ["gone"])).toBeNull();
    expect(dependencyProblem(chain, "c", [], ["gone"])).toBeNull();
    expect(dependencyProblem(chain, "a", ["gone", "c"], ["gone"])).toMatch(
      /pętlę/,
    );
  });

  it("applies additions and removals to the list", () => {
    expect(
      patchedDependsOn(["a", "b"], {
        addDependsOn: ["c", "a"],
        removeDependsOn: ["b"],
      }),
    ).toEqual(["a", "c"]);
    expect(patchedDependsOn(["a"], { dependsOn: ["x", "x"] })).toEqual(["x"]);
  });
});

describe("goals", () => {
  const tasks = [
    task("merge", { status: "done" }),
    task("deploy", { dependsOn: ["merge"] }),
    task("upload", { dependsOn: ["deploy", "gone"] }),
    task("milestone", { kind: "goal", dependsOn: ["deploy"] }),
    task("live", { kind: "goal", dependsOn: ["upload", "milestone"] }),
    task("other"),
  ];

  it("finds everything a task waits on, through the chain", () => {
    expect([...taskAncestors(tasks, "live")].sort()).toEqual([
      "deploy",
      "merge",
      "milestone",
      "upload",
    ]);
    expect(taskAncestors(tasks, "merge").size).toBe(0);
  });

  it("counts what leads to a goal, and not the goals on the way", () => {
    expect(goalProgress(tasks, "live")).toEqual({ closed: 1, total: 3 });
    expect(goalProgress(tasks, "other")).toEqual({ closed: 0, total: 0 });
  });

  it("keeps goals on a list of their own until they are closed", () => {
    const states = taskStates(tasks);
    const section = (id: string) =>
      taskSection(
        tasks.find((t) => t.id === id)!,
        states.get(id)!,
      );
    expect(section("live")).toBe("goals");
    expect(section("milestone")).toBe("goals");
    expect(
      taskSection(
        task("reached", { kind: "goal", status: "done" }),
        taskStates([task("reached", { kind: "goal", status: "done" })]).get(
          "reached",
        )!,
      ),
    ).toBe("closed");
  });
});

describe("dependencyChange and taskEditPatch", () => {
  it("sends what was added and taken away, not the whole list", () => {
    expect(dependencyChange(["a", "b"], ["b", "c"])).toEqual({
      addDependsOn: ["c"],
      removeDependsOn: ["a"],
    });
    expect(dependencyChange(["a"], ["a"])).toEqual({});
  });

  it("sends only the fields an edit changed", () => {
    const opened = task("x", { title: "Old", tags: ["a"], dependsOn: ["d"] });
    const edit = {
      title: "Old",
      body: "",
      kind: opened.kind,
      who: "agent" as const,
      dependsOn: ["d", "e"],
      tags: ["a"],
      links: [],
      branches: [],
    };
    expect(taskEditPatch(opened, edit)).toEqual({
      who: "agent",
      addDependsOn: ["e"],
    });
    expect(
      taskEditPatch(opened, { ...edit, who: "owner", dependsOn: ["d"] }),
    ).toBeNull();
  });
});

describe("applyTaskPatch", () => {
  const patch = (input: unknown) => taskPatchSchema.parse(input);

  it("logs what changed, and stamps closing", () => {
    const { task: done, logged } = applyTaskPatch(
      task("deploy", { dependsOn: ["merge"] }),
      patch({ status: "done", removeDependsOn: ["merge"], note: "Wdrożone." }),
      "owner",
      T1,
    );
    expect(done.status).toBe("done");
    expect(done.closedAt).toBe(T1);
    expect(done.updatedAt).toBe(T1);
    expect(done.dependsOn).toEqual([]);
    expect(logged.map((e) => e.text)).toEqual([
      "Status: otwarte → zrobione.",
      "Już nie czeka na: merge.",
      "Wdrożone.",
    ]);
    expect(done.log).toEqual(logged);
  });

  it("keeps no repeats in the lists it is given", () => {
    const { task: next } = applyTaskPatch(
      task("x"),
      patch({ tags: ["deploy", "deploy"], branches: ["b", "b"] }),
      "agent",
      T1,
    );
    expect(next.tags).toEqual(["deploy"]);
    expect(next.branches).toEqual(["b"]);
  });

  it("clears the closing stamp on reopening, and a rank on null", () => {
    const { task: reopened } = applyTaskPatch(
      task("x", { status: "done", closedAt: T0, rank: 5 }),
      patch({ status: "open", rank: null }),
      "agent",
      T1,
    );
    expect(reopened.closedAt).toBeUndefined();
    expect(reopened.rank).toBeUndefined();
  });

  it("keeps only the newest history", () => {
    const log = Array.from({ length: LOG_KEEP }, (_, i) => ({
      at: T0,
      by: "agent" as const,
      text: `line ${i}`,
    }));
    const { task: next } = applyTaskPatch(
      task("x", { log }),
      patch({ note: "newest" }),
      "owner",
      T1,
    );
    expect(next.log).toHaveLength(LOG_KEEP);
    expect(next.log.at(-1)!.text).toBe("newest");
    expect(next.log[0]!.text).toBe("line 1");
  });

  it("refuses an empty patch", () => {
    expect(taskPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("newTask", () => {
  it("fills the defaults a quick note leaves out", () => {
    const made = newTask(
      taskCreateSchema.parse({
        title: "  Deploy the rules  ",
        tags: ["a", "a"],
      }),
      "deploy-the-rules",
      "agent:bridge-cse_01",
      T0,
    );
    expect(made).toMatchObject({
      id: "deploy-the-rules",
      title: "Deploy the rules",
      kind: "task",
      who: "owner",
      status: "open",
      tags: ["a"],
      createdBy: "agent:bridge-cse_01",
      log: [],
    });
    expect(made.closedAt).toBeUndefined();
  });

  it("refuses an id that is not a slug", () => {
    expect(
      taskCreateSchema.safeParse({ id: "Not A Slug", title: "x" }).success,
    ).toBe(false);
  });
});

describe("similarTasks", () => {
  it("finds an open task about the same thing, by title or branch", () => {
    const tasks = [
      task("upload-names", {
        title: "Upload nameless-company names (companies-names.jsonl) to prod",
      }),
      task("merge-x", { title: "Merge something", branches: ["fb27-x"] }),
      task("closed", {
        title: "Upload nameless-company names again",
        status: "done",
      }),
      task("other", { title: "Deploy Firestore rules" }),
    ];
    expect(
      similarTasks(tasks, {
        title: "Upload the nameless company names to prod",
      }).map((t) => t.id),
    ).toEqual(["upload-names"]);
    expect(
      similarTasks(tasks, { title: "Land it", branches: ["fb27-x"] }).map(
        (t) => t.id,
      ),
    ).toEqual(["merge-x"]);
  });
});

describe("sections and order", () => {
  it("puts each task on one list", () => {
    const tasks = [
      task("mine"),
      task("agents", { who: "agent" }),
      task("blocked", { dependsOn: ["mine"] }),
      task("idea", { kind: "idea", dependsOn: ["mine"] }),
      task("parked", { status: "parked" }),
      task("closed", { status: "dropped" }),
    ];
    const states = taskStates(tasks);
    expect(
      Object.fromEntries(
        tasks.map((t) => [t.id, taskSection(t, states.get(t.id)!)]),
      ),
    ).toEqual({
      mine: "mine",
      agents: "agents",
      blocked: "blocked",
      idea: "ideas",
      parked: "parked",
      closed: "closed",
    });
  });

  it("orders by hand-set rank, then the older task", () => {
    const sorted = [
      task("new", { createdAt: T1 }),
      task("ranked", { rank: 10, createdAt: T1 }),
      task("old", { createdAt: T0 }),
      task("first", { rank: -5, createdAt: T1 }),
    ].sort(compareTasks);
    expect(sorted.map((t) => t.id)).toEqual(["first", "ranked", "old", "new"]);
  });

  it("puts the newest first when asked, rank or not", () => {
    const sorted = [
      task("old", { createdAt: T0 }),
      task("ranked", { rank: -5, createdAt: T0 }),
      task("b-new", { createdAt: T1 }),
      task("a-new", { createdAt: T1 }),
    ].sort(compareNewest);
    expect(sorted.map((t) => t.id)).toEqual([
      "a-new",
      "b-new",
      "old",
      "ranked",
    ]);
  });

  it("links to a task's row", () => {
    expect(taskUrl("deploy-rules")).toBe(
      "https://koryta.pl/admin/zadania#t-deploy-rules",
    );
  });
});

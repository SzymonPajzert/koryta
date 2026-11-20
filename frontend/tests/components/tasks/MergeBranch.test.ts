import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import MergeBranch from "../../../app/components/tasks/MergeBranch.vue";
import Row from "../../../app/components/tasks/Row.vue";
import {
  taskSection,
  taskStates,
  type MergeCheck,
  type Task,
} from "../../../shared/tasks";

const T0 = "2026-11-19T11:40:00.000Z";

function merge(fields: Partial<Task> = {}): Task {
  return {
    id: "merge-x",
    title: "Merge people-ingest-identity: match an ingested person by name",
    body: "",
    kind: "merge",
    who: "owner",
    status: "open",
    dependsOn: [],
    tags: [],
    links: [],
    branches: ["people-ingest-identity"],
    createdAt: T0,
    updatedAt: T0,
    createdBy: "agent",
    log: [],
    ...fields,
  };
}

const check = (
  branches: MergeCheck["branches"],
  state: MergeCheck["state"],
): MergeCheck => ({ state, branches, checkedAt: T0, main: "8a5f46d5e98f" });

describe("TasksMergeBranch", () => {
  it("links the branch's changes against main and the branch itself", async () => {
    const wrapper = await mountSuspended(MergeBranch, {
      props: { task: merge() },
    });
    const links = wrapper.findAll("a").map((a) => a.attributes("href"));
    expect(links).toEqual([
      "https://github.com/SzymonPajzert/koryta/compare/main...people-ingest-identity",
      "https://github.com/SzymonPajzert/koryta/tree/people-ingest-identity",
    ]);
    expect(wrapper.text()).toContain("Jeszcze nie sprawdzone.");
  });

  it("draws a dot per commit, filled for each already on main", async () => {
    const wrapper = await mountSuspended(MergeBranch, {
      props: {
        task: merge({
          mergeCheck: check(
            [
              {
                name: "people-ingest-identity",
                state: "partial",
                commits: 10,
                landed: 9,
              },
            ],
            "partial",
          ),
        }),
      },
    });
    expect(wrapper.findAll(".task-merge__dot")).toHaveLength(10);
    expect(wrapper.findAll(".task-merge__dot--landed")).toHaveLength(9);
    expect(wrapper.text()).toContain("Na main 9 z 10 zmian.");
    expect(wrapper.text()).toContain("na main 8a5f46d5");
  });

  it("counts after „z” in the genitive", async () => {
    const wrapper = await mountSuspended(MergeBranch, {
      props: {
        task: merge({
          mergeCheck: check(
            [
              {
                name: "people-ingest-identity",
                state: "partial",
                commits: 3,
                landed: 1,
              },
            ],
            "partial",
          ),
        }),
      },
    });
    expect(wrapper.text()).toContain("Na main 1 z 3 zmian.");
  });

  it("says a branch is gone, without links to it, and asks for a missing one", async () => {
    const gone = await mountSuspended(MergeBranch, {
      props: {
        task: merge({
          mergeCheck: check(
            [
              {
                name: "people-ingest-identity",
                state: "gone",
                commits: 0,
                landed: 0,
              },
            ],
            "gone",
          ),
        }),
      },
    });
    expect(gone.text()).toContain("Gałęzi nie ma już na GitHubie.");
    expect(gone.findAll("a")).toHaveLength(0);
    const none = await mountSuspended(MergeBranch, {
      props: { task: merge({ branches: [] }) },
    });
    expect(none.get("[data-task-merge-missing]").text()).toContain(
      "Brak gałęzi",
    );
  });
});

describe("TasksRow for a merge and a decision", () => {
  const row = (task: Task, all: Task[] = [task]) => {
    const state = taskStates(all).get(task.id)!;
    return mountSuspended(Row, {
      props: { task, state, section: taskSection(task, state), tasks: all },
    });
  };

  it("leads with the branch, and tags only what is on main", async () => {
    const waiting = await row(
      merge({
        mergeCheck: check(
          [
            {
              name: "people-ingest-identity",
              state: "open",
              commits: 3,
              landed: 0,
            },
          ],
          "open",
        ),
      }),
    );
    expect(waiting.get("[data-task-branch]").text()).toBe(
      "people-ingest-identity",
    );
    expect(waiting.text()).toContain("match an ingested person by name");
    expect(waiting.find("[data-task-merge-state]").exists()).toBe(false);

    const partly = await row(
      merge({
        mergeCheck: check(
          [
            {
              name: "people-ingest-identity",
              state: "partial",
              commits: 10,
              landed: 9,
            },
          ],
          "partial",
        ),
      }),
    );
    expect(partly.get("[data-task-merge-state]").text()).toBe("9/10 na main");
  });

  it("counts a decision's options, and says which one was picked", async () => {
    const options = [
      { key: "A", title: "One" },
      { key: "B", title: "Other" },
    ];
    const asked = await row(
      merge({ id: "d", kind: "decision", branches: [], options }),
    );
    expect(asked.get("[data-task-option-count]").text()).toBe("2 opcje");

    const answered = merge({
      id: "d",
      kind: "decision",
      branches: [],
      status: "doing",
      options,
      picked: { key: "B", at: T0, by: "owner" },
    });
    const follow = merge({
      id: "f",
      kind: "task",
      branches: [],
      dependsOn: ["d"],
    });
    const wrapper = await row(answered, [answered, follow]);
    expect(wrapper.get("[data-task-picked]").text()).toBe("Wybrano B");
    // Answered, it holds nothing up any more.
    expect(wrapper.text()).not.toContain("blokuje");
  });
});

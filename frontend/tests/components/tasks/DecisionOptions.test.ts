import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import DecisionOptions from "../../../app/components/tasks/DecisionOptions.vue";
import { taskStates, type Task } from "../../../shared/tasks";

const T0 = "2026-11-01T10:00:00.000Z";

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

const options = [
  { key: "A", title: "Move the answers" },
  { key: "B", title: "Take them over in place" },
];

const decision = (fields: Partial<Task> = {}) =>
  task("decide", {
    kind: "decision",
    title: "Decide how a sign-in claims a browser's readings",
    question: "How should a sign-in claim the readings?",
    options,
    recommended: "B",
    ...fields,
  });

const mount = (current: Task, others: Task[] = []) => {
  const all = [current, ...others];
  return mountSuspended(DecisionOptions, {
    props: { task: current, state: taskStates(all).get(current.id)! },
  });
};

describe("TasksDecisionOptions", () => {
  it("asks the question first, then offers the answers, the recommended one marked", async () => {
    const wrapper = await mount(decision());
    expect(wrapper.get("[data-task-question]").text()).toBe(
      "How should a sign-in claim the readings?",
    );
    const answers = wrapper.findAll("[data-task-option]");
    expect(answers.map((a) => a.attributes("data-task-option"))).toEqual([
      "A",
      "B",
    ]);
    expect(answers[1]!.find("[data-task-recommended]").exists()).toBe(true);
    expect(answers[0]!.find("[data-task-recommended]").exists()).toBe(false);
  });

  it("stands the title in for a question it was not given", async () => {
    const wrapper = await mount(decision({ question: undefined }));
    expect(wrapper.get("[data-task-question]").text()).toBe(
      "Decide how a sign-in claims a browser's readings",
    );
  });

  it("sends the answer picked with one click", async () => {
    const wrapper = await mount(decision());
    await wrapper.get('[data-task-option="A"]').trigger("click");
    expect(wrapper.emitted("pick")).toEqual([["A"]]);
  });

  it("shows the answer given, what follows from it, and the way back", async () => {
    const answered = decision({
      status: "doing",
      picked: { key: "A", at: T0, by: "owner" },
    });
    const done = task("merge-a", { status: "done", dependsOn: ["decide"] });
    const open = task("merge-b", { dependsOn: ["decide"] });
    const wrapper = await mount(answered, [done, open]);
    expect(wrapper.text()).toContain("Wybrano");
    expect(
      wrapper.get('[data-task-option="A"]').attributes("aria-pressed"),
    ).toBe("true");
    const follows = wrapper.get("[data-task-follows]");
    expect(follows.text()).toContain("Wynikają z niej 2 zadania, zamknięte 1.");
    // The open one first: it is what is left.
    expect(follows.findAll("li").map((li) => li.text())).toEqual([
      expect.stringContaining("Task merge-b"),
      expect.stringContaining("Task merge-a"),
    ]);
    await wrapper.get("[data-task-unpick]").trigger("click");
    expect(wrapper.emitted("pick")).toEqual([[null]]);
  });

  it("asks before changing an answer work has already followed", async () => {
    const answered = decision({
      status: "doing",
      picked: { key: "A", at: T0, by: "owner" },
    });
    const done = task("merge-a", { status: "done", dependsOn: ["decide"] });
    const wrapper = await mount(answered, [done]);
    await wrapper.get('[data-task-option="B"]').trigger("click");
    expect(wrapper.emitted("pick")).toBeUndefined();
    const confirm = wrapper.get("[data-task-option-confirm]");
    expect(confirm.text()).toContain("Według A zrobiono już: 1 zadanie.");
    await confirm.get("button").trigger("click");
    expect(wrapper.emitted("pick")).toEqual([["B"]]);
  });

  it("changes an answer at once when nothing has followed it yet", async () => {
    const answered = decision({
      status: "doing",
      picked: { key: "A", at: T0, by: "owner" },
    });
    const wrapper = await mount(answered, [
      task("next", { dependsOn: ["decide"] }),
    ]);
    await wrapper.get('[data-task-option="B"]').trigger("click");
    expect(wrapper.emitted("pick")).toEqual([["B"]]);
  });
});

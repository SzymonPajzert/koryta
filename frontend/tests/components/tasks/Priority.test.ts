import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PriorityBadge from "../../../app/components/tasks/PriorityBadge.vue";
import Details from "../../../app/components/tasks/Details.vue";
import { taskStates, type Task } from "../../../shared/tasks";

const T0 = "2026-09-28T08:00:00.000Z";

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

/** A goal set to high with a chain leading to it, beside an urgent task an
 * agent raised. */
const tasks = [
  task("decide", { kind: "decision" }),
  task("upload", { dependsOn: ["decide"] }),
  task("live", {
    title: "Umowy na stronie",
    kind: "goal",
    priority: "high",
    prioritySetBy: "owner",
    dependsOn: ["upload"],
  }),
  task("merge"),
  task("leak", {
    title: "Zamknij wyciek",
    priority: "urgent",
    prioritySetBy: "agent:bridge-cse_01",
    dependsOn: ["merge"],
  }),
];
const states = taskStates(tasks);
const byId = new Map(tasks.map((t) => [t.id, t]));

const badge = (id: string, compact = false) =>
  mountSuspended(PriorityBadge, {
    props: { task: byId.get(id)!, state: states.get(id)!, compact },
  });

describe("TasksPriorityBadge", () => {
  it("fills a task's own level, and says who set it", async () => {
    const wrapper = await badge("leak");
    const pill = wrapper.get("[data-task-priority]");
    expect(pill.attributes("data-task-priority")).toBe("urgent");
    expect(pill.classes()).not.toContain("task-priority--taken");
    expect(pill.text()).toContain("Pilne");
    expect(pill.attributes("title")).toBe("Pilne · agent (bridge-cse_01)");
  });

  it("outlines a level taken from a goal the task leads to", async () => {
    const wrapper = await badge("decide");
    const pill = wrapper.get("[data-task-priority]");
    expect(pill.attributes("data-task-priority")).toBe("high-taken");
    expect(pill.classes()).toContain("task-priority--taken");
    expect(pill.text()).toContain("do ważnego celu");
    expect(pill.attributes("title")).toBe(
      "Ważne, bo czeka na nie: cel „Umowy na stronie”",
    );
  });

  it("names a task it holds up as blocking, and on a card only the level", async () => {
    expect((await badge("merge")).text()).toContain("blokuje pilne");
    const card = await badge("merge", true);
    expect(card.text()).toBe("Pilne");
  });

  it("draws nothing for a normal task", async () => {
    const plain = task("plain");
    const wrapper = await mountSuspended(PriorityBadge, {
      props: { task: plain, state: taskStates([plain]).get("plain")! },
    });
    expect(wrapper.find("[data-task-priority]").exists()).toBe(false);
  });
});

describe("TasksDetails priority", () => {
  const details = (id: string) =>
    mountSuspended(Details, {
      props: { task: byId.get(id)!, state: states.get(id)!, tasks },
    });

  it("sends the level picked, as a patch", async () => {
    const wrapper = await details("merge");
    const buttons = wrapper.findAll("[data-task-priority-toggle] button");
    expect(buttons.map((b) => b.text())).toEqual(["Zwykłe", "Ważne", "Pilne"]);
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("update")).toEqual([[{ priority: "high" }]]);
  });

  it("names what a taken level comes from, and opens it on a click", async () => {
    const wrapper = await details("upload");
    const from = wrapper.get("[data-task-priority-from]");
    expect(from.text()).toContain("Ważne, bo czeka na nie:");
    expect(from.text()).toContain("Umowy na stronie");
    await from.get(".v-chip").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["live"]]);
  });

  it("says which agent raised a level", async () => {
    const wrapper = await details("leak");
    expect(wrapper.get("[data-task-priority-field]").text()).toContain(
      "ustawił agent (bridge-cse_01)",
    );
    expect(
      (await details("live")).get("[data-task-priority-field]").text(),
    ).not.toContain("ustawił");
  });
});

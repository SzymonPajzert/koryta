import { afterEach, describe, it, expect } from "vitest";
import { nextTick } from "vue";
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

// The menu's overlay observes its activator as it opens; happy-dom has no
// ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("TasksDetails priority", () => {
  // The menu teleports into document.body: mounted there, and cleared after.
  let mounted: { unmount: () => void } | undefined;
  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = "";
  });
  const details = async (id: string) => {
    const wrapper = await mountSuspended(Details, {
      props: { task: byId.get(id)!, state: states.get(id)!, tasks },
      attachTo: document.body,
    });
    mounted = wrapper;
    return wrapper;
  };

  /** Opens the priority menu and returns its entries, by level. */
  const openMenu = async (wrapper: Awaited<ReturnType<typeof details>>) => {
    const button = wrapper.get("[data-task-priority-menu]");
    await button.trigger("click");
    await nextTick();
    const menu = document.getElementById(button.attributes("aria-controls")!);
    if (!menu) throw new Error("no priority menu opened");
    return menu;
  };

  it("says the task's own level on a button at the top", async () => {
    const top = (await details("merge")).get("[data-task-actions]");
    expect(top.get("[data-task-priority-menu]").text()).toBe("Zwykłe");
    const urgent = await details("leak");
    expect(urgent.get("[data-task-priority-menu]").text()).toBe("Pilne");
  });

  it("sends the level picked in the menu, as a patch", async () => {
    const wrapper = await details("merge");
    const menu = await openMenu(wrapper);
    const entries = [
      ...menu.querySelectorAll<HTMLElement>("[data-task-priority-choice]"),
    ];
    expect(entries.map((e) => e.dataset.taskPriorityChoice)).toEqual([
      "urgent",
      "high",
      "normal",
    ]);
    entries[1]!.click();
    expect(wrapper.emitted("update")).toEqual([[{ priority: "high" }]]);
    // The level it has already sends nothing.
    entries[2]!.click();
    expect(wrapper.emitted("update")).toHaveLength(1);
  });

  it("names what a taken level comes from, and opens it on a click", async () => {
    const wrapper = await details("upload");
    const from = wrapper.get("[data-task-priority-from]");
    expect(from.text()).toContain("Ważne, bo czeka na nie:");
    expect(from.text()).toContain("Umowy na stronie");
    await from.get(".v-chip").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["live"]]);
  });

  it("says which agent raised a level, in the menu", async () => {
    const leak = await details("leak");
    expect(leak.get("[data-task-priority-menu]").attributes("title")).toContain(
      "ustawił agent (bridge-cse_01)",
    );
    const menu = await openMenu(leak);
    expect(
      menu.querySelector("[data-task-priority-set-by]")?.textContent,
    ).toContain("ustawił agent (bridge-cse_01)");
    const live = await details("live");
    expect(
      live.get("[data-task-priority-menu]").attributes("title"),
    ).not.toContain("ustawił");
  });
});

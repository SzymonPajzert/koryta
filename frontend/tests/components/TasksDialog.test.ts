import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import TasksDialog from "../../app/components/tasks/Dialog.vue";
import type { Task, TaskCreate, TaskEdit, TaskPatch } from "~~/shared/tasks";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** The dialog in place, open or not at all - the real one is an overlay
 * teleported out of the wrapper. */
const DialogStub = defineComponent({
  props: { modelValue: Boolean },
  setup(props, { slots }) {
    return () => (props.modelValue ? h("div", slots.default?.()) : null);
  },
});

const task: Task = {
  id: "deploy-indeksow",
  title: "Wdróż indeksy",
  body: "npx firebase deploy --only firestore:indexes",
  kind: "action",
  who: "owner",
  status: "open",
  dependsOn: [],
  tags: ["deploy"],
  links: [],
  branches: [],
  createdAt: "2026-09-28T10:00:00.000Z",
  updatedAt: "2026-09-28T10:00:00.000Z",
  createdBy: "owner",
  log: [],
};

const draft: Partial<TaskEdit> = {
  title: "Filtr po województwie",
  body: "Przydałby się filtr.\n\nZgłoszenie: https://koryta.pl/admin/opinie#fb-abc",
  kind: "idea",
  who: "owner",
  tags: ["opinie"],
  links: ["https://koryta.pl/admin/opinie#fb-abc"],
};

async function mount(props: {
  task?: Task | null;
  draft?: Partial<TaskEdit> | null;
  submit: (value: TaskCreate | TaskPatch) => Promise<boolean>;
}) {
  const wrapper = await mountSuspended(TasksDialog, {
    props: { modelValue: false, tasks: [task], ...props },
    slots: {
      "after-title": (slot: { title: string }) =>
        h("p", { "data-after-title": "" }, `tytuł: ${slot.title}`),
    },
    global: { stubs: { VDialog: DialogStub } },
  });
  // Filled in as it opens, as on the page.
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

describe("TasksDialog", () => {
  it("starts a new task from a draft, and sends it as it was left", async () => {
    const submit = vi.fn(async () => true);
    const wrapper = await mount({ draft, submit });

    const title = wrapper.get("[data-task-title] input");
    expect((title.element as HTMLInputElement).value).toBe(
      "Filtr po województwie",
    );
    // What the page shows beside the title follows what is typed there.
    expect(wrapper.get("[data-after-title]").text()).toBe(
      "tytuł: Filtr po województwie",
    );
    await title.setValue("Filtr po województwie i powiecie");
    expect(wrapper.get("[data-after-title]").text()).toBe(
      "tytuł: Filtr po województwie i powiecie",
    );

    await wrapper.get("[data-task-save]").trigger("click");
    await flushPromises();
    expect(submit).toHaveBeenCalledWith({
      title: "Filtr po województwie i powiecie",
      body: draft.body,
      kind: "idea",
      who: "owner",
      dependsOn: [],
      tags: ["opinie"],
      links: ["https://koryta.pl/admin/opinie#fb-abc"],
      branches: [],
    });
    // The draft is the page's: what was typed stays out of it.
    expect(draft.title).toBe("Filtr po województwie");
    expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);
  });

  it("changes a task as it is, whatever draft it was given", async () => {
    const submit = vi.fn(async () => true);
    const wrapper = await mount({ task, draft, submit });

    expect(
      (wrapper.get("[data-task-title] input").element as HTMLInputElement)
        .value,
    ).toBe("Wdróż indeksy");
  });
});

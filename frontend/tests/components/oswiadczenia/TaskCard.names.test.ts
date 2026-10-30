import { describe, it, expect, afterEach, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import TaskCard from "../../../app/components/oswiadczenia/TaskCard.vue";
import {
  READ_NAME_MAX_LENGTH,
  type DeclarationTask,
} from "../../../shared/declarations";

// The card as it reads with names switched on: off for now, kept working
// for the day they are (READ_NAMES).
vi.mock("~~/shared/declarations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/declarations")>()),
  READ_NAMES: true,
}));

const task: DeclarationTask = {
  id: "crop-1",
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy",
  declarationYear: 2019,
  images: {
    date: "data:image/png;base64,ZGF0YQ==",
    name: "data:image/png;base64,bmF6d2lza28=",
  },
  imageSize: {
    date: { width: 950, height: 105 },
    name: { width: 1160, height: 94 },
  },
};

const withoutName: DeclarationTask = {
  ...task,
  id: "crop-2",
  images: { date: task.images.date, name: null },
  imageSize: { date: task.imageSize.date, name: null },
};

const mounted: { unmount: () => void }[] = [];

async function mount(
  props: {
    task?: DeclarationTask;
    draft?: { date: string; name: string } | null;
  } = {},
) {
  const wrapper = await mountSuspended(TaskCard, {
    props: { task, ...props },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const DATE = '[data-testid="declaration-date-input"]';
const NAME = '[data-testid="declaration-name-input"]';

describe("OswiadczeniaTaskCard with names read", () => {
  it("lays out both lines of the paper, and a field for the name", async () => {
    const wrapper = await mount();

    expect(
      wrapper.get('[data-testid="declaration-crop-name"]').attributes("src"),
    ).toBe(task.images.name);
    expect(wrapper.find(NAME).exists()).toBe(true);
  });

  it("asks for no name where the paper has no name line", async () => {
    const wrapper = await mount({ task: withoutName });

    expect(wrapper.find('[data-testid="declaration-crop-name"]').exists()).toBe(
      false,
    );
    expect(wrapper.find(NAME).exists()).toBe(false);
  });

  it("sends the name read off the paper with the date, when one was typed", async () => {
    const wrapper = await mount();

    await wrapper.get(DATE).setValue("15 VII 1979");
    await wrapper.get(NAME).setValue("  Jan Przykładowy ");
    await wrapper.get('[data-testid="declaration-submit"]').trigger("click");

    expect(wrapper.emitted("answer")).toEqual([
      [task, { verdict: "date", value: "1979-07-15", name: "Jan Przykładowy" }],
    ]);
  });

  // The server turns a longer one down, and the whole answer with it
  // (tests/server/api/declarations/endpoints.test.ts).
  it("takes no longer a name than the server keeps", async () => {
    const wrapper = await mount();

    expect(wrapper.get(NAME).attributes("maxlength")).toBe(
      String(READ_NAME_MAX_LENGTH),
    );
  });

  // A skip says nothing about the crop, so it carries no name either.
  it("skips without the name", async () => {
    const wrapper = await mount();
    await wrapper.get(NAME).setValue("Jan Przykładowy");

    await wrapper.get('[data-testid="declaration-skip"]').trigger("click");

    expect(wrapper.emitted("answer")).toEqual([[task, { verdict: "skip" }]]);
  });

  it("fills both fields from a draft that came back", async () => {
    const wrapper = await mount({
      draft: { date: "15.07.1979", name: "Jan Przykładowy" },
    });

    expect((wrapper.get(DATE).element as HTMLInputElement).value).toBe(
      "15.07.1979",
    );
    expect((wrapper.get(NAME).element as HTMLInputElement).value).toBe(
      "Jan Przykładowy",
    );
  });
});

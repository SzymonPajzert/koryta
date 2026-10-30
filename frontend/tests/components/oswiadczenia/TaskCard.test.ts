import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import TaskCard from "../../../app/components/oswiadczenia/TaskCard.vue";
import type { DeclarationTask } from "../../../shared/declarations";

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

/** In the document, so the „Zapisz” button submits its form the way it does
 * in a browser: happy-dom submits only a connected form. */
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
const READING = '[data-testid="declaration-reading"]';

/** The card a reader reads one crop on, „jedno pole”: Szymon's pick of round
 * bip-czytanie-r1. One field takes the date however it is typed and says back
 * what it understood, so a slip of a digit is seen before it is sent; the
 * other answers are three text buttons under it. */
describe("OswiadczeniaTaskCard", () => {
  it("lays out both lines of the paper, and says whose only by unit and office", async () => {
    const wrapper = await mount();

    expect(
      wrapper.get('[data-testid="declaration-crop-date"]').attributes("src"),
    ).toBe(task.images.date);
    expect(
      wrapper.get('[data-testid="declaration-crop-name"]').attributes("src"),
    ).toBe(task.images.name);
    expect(wrapper.text()).toContain(
      "Rada gminy · Testowice (gmina miejsko-wiejska) · oświadczenie za 2019",
    );
    expect(wrapper.find(NAME).exists()).toBe(true);
    // Before anything is typed, the line beside the label says what the field
    // takes.
    expect(wrapper.get(READING).text()).toBe(
      "np. 15.07.1979, 15 VII 1979 albo sam rok",
    );
  });

  it("asks for no name where the paper has no name line", async () => {
    const wrapper = await mount({ task: withoutName });

    expect(wrapper.find('[data-testid="declaration-crop-date"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="declaration-crop-name"]').exists()).toBe(
      false,
    );
    expect(wrapper.find(NAME).exists()).toBe(false);
  });

  it("says back what it understood of a day, and of a year typed alone", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("15.07.1979");
    expect(wrapper.get(READING).text()).toBe("15 lipca 1979");
    expect(wrapper.get(READING).classes()).toContain("ow-reading--ok");

    await input.setValue("1979");
    expect(wrapper.get(READING).text()).toBe("tylko rok: 1979");
  });

  it("refuses a day that does not exist, and says why, without sending it", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("31.02.1979");
    await wrapper.get('[data-testid="declaration-submit"]').trigger("click");

    expect(wrapper.emitted("answer")).toBeUndefined();
    const reading = wrapper.get(READING);
    expect(reading.text()).toBe("Taki dzień nie istnieje.");
    expect(reading.classes()).toContain("ow-reading--error");
    expect(input.classes()).toContain("ow-card__input--error");
  });

  it("asks for a date, or one of the other answers, when the field is sent empty", async () => {
    const wrapper = await mount();

    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("answer")).toBeUndefined();
    expect(wrapper.get(READING).text()).toBe(
      "Wpisz datę albo wybierz „Nie da się odczytać” lub „Pole jest puste”.",
    );
  });

  // Enter in the field submits its form in a browser; happy-dom does not do
  // that implicit submission, so the test submits the form itself.
  it("sends a typed date when its form is submitted, as YYYY-MM-DD", async () => {
    const wrapper = await mount();

    await wrapper.get(DATE).setValue("15.07.1979");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("answer")).toEqual([
      [task, { verdict: "date", value: "1979-07-15" }],
    ]);
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

  // A skip says nothing about the crop, so it carries no name either.
  it("answers „unreadable”, „empty” and „skip” from the three text buttons", async () => {
    const wrapper = await mount();
    await wrapper.get(NAME).setValue("Jan Przykładowy");

    await wrapper
      .get('[data-testid="declaration-unreadable"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="declaration-empty-field"]')
      .trigger("click");
    await wrapper.get('[data-testid="declaration-skip"]').trigger("click");

    expect(wrapper.emitted("answer")).toEqual([
      [task, { verdict: "unreadable", name: "Jan Przykładowy" }],
      [task, { verdict: "empty", name: "Jan Przykładowy" }],
      [task, { verdict: "skip" }],
    ]);
  });

  // A crop whose save failed comes back with what the reader had typed.
  it("fills the fields from a draft that came back", async () => {
    const wrapper = await mount({
      draft: { date: "15.07.1979", name: "Jan Przykładowy" },
    });

    expect((wrapper.get(DATE).element as HTMLInputElement).value).toBe(
      "15.07.1979",
    );
    expect((wrapper.get(NAME).element as HTMLInputElement).value).toBe(
      "Jan Przykładowy",
    );
    expect(wrapper.get(READING).text()).toBe("15 lipca 1979");
  });
});

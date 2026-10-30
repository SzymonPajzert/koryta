import { describe, it, expect, afterEach, vi } from "vitest";
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

const mounted: { unmount: () => void }[] = [];

/** In the document, so the card's button submits its form the way it does in
 * a browser: happy-dom submits only a connected form. */
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
const SKIP = '[data-testid="declaration-skip"]';
const SAVE = '[data-testid="declaration-submit"]';

/** The card a reader reads one crop on, „jedno pole”: Szymon's pick of round
 * bip-czytanie-r1. One field takes the date however it is typed and says back
 * what it understood, so a slip of a digit is seen before it is sent; one
 * button beside it skips the crop until something is typed and saves it once
 * something is (his call of 2026-10-30). The name line and its field stay off
 * while readers are not asked for names (READ_NAMES); TaskCard.names.test.ts
 * keeps them working for the day they are. */
describe("OswiadczeniaTaskCard", () => {
  it("lays out the date line alone, with no word of whose it is", async () => {
    const wrapper = await mount();

    expect(
      wrapper.get('[data-testid="declaration-crop-date"]').attributes("src"),
    ).toBe(task.images.date);
    // Even a task that carries a name line: names are not read for now.
    expect(wrapper.find('[data-testid="declaration-crop-name"]').exists()).toBe(
      false,
    );
    expect(wrapper.find(NAME).exists()).toBe(false);
    // Nor the office, the unit or the year (Szymon, round bip-czytanie-r3).
    expect(wrapper.text()).not.toContain("Testowice");
    expect(wrapper.text()).not.toContain("2019");
    // A label and the field's own „dd.mm.rrrr”, and no examples under it.
    expect(wrapper.get("label").text()).toBe("Data urodzenia");
    expect(wrapper.get(DATE).attributes("placeholder")).toBe("dd.mm.rrrr");
    expect(wrapper.get(READING).text()).toBe("");
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

  it("offers „Pomiń” while nothing is typed, and skips the crop with it, asking no reason", async () => {
    const wrapper = await mount();

    expect(wrapper.get(SKIP).text()).toBe("Pomiń");
    expect(wrapper.find(SAVE).exists()).toBe(false);
    await wrapper.get(SKIP).trigger("click");

    expect(wrapper.emitted("answer")).toEqual([[task, { verdict: "skip" }]]);
    expect(
      wrapper.find('[data-testid="declaration-unreadable"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-testid="declaration-empty-field"]').exists(),
    ).toBe(false);
  });

  // Enter in the field submits its form in a browser; happy-dom does not do
  // that implicit submission, so the tests submit the form themselves.
  it("skips when the empty field is sent with Enter, as its button says", async () => {
    const wrapper = await mount();

    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("answer")).toEqual([[task, { verdict: "skip" }]]);
  });

  it("turns „Pomiń” into „Zapisz” once something is typed, and back once it is cleared", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("1");
    expect(wrapper.get(SAVE).text()).toBe("Zapisz");
    expect(wrapper.find(SKIP).exists()).toBe(false);

    // A whitespace-only field is still empty.
    await input.setValue("  ");
    expect(wrapper.get(SKIP).text()).toBe("Pomiń");
  });

  it("refuses a day that does not exist, and says why, without sending it", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("31.02.1979");
    await wrapper.get(SAVE).trigger("click");

    expect(wrapper.emitted("answer")).toBeUndefined();
    const reading = wrapper.get(READING);
    expect(reading.text()).toBe("Taki dzień nie istnieje.");
    expect(reading.classes()).toContain("ow-reading--error");
    expect(input.classes()).toContain("ow-card__input--error");

    // Cleared after the refusal, the field is no longer in error: its button
    // skips again, which is no mistake.
    await input.setValue("");
    expect(input.classes()).not.toContain("ow-card__input--error");
    expect(wrapper.get(READING).text()).toBe("");
  });

  it("sends a typed date when its form is submitted, as YYYY-MM-DD", async () => {
    const wrapper = await mount();

    await wrapper.get(DATE).setValue("15.07.1979");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("answer")).toEqual([
      [task, { verdict: "date", value: "1979-07-15" }],
    ]);
  });

  // A crop whose save failed comes back with what the reader had typed.
  it("fills the date from a draft that came back, and offers to save it", async () => {
    const wrapper = await mount({
      draft: { date: "15.07.1979", name: "" },
    });

    expect((wrapper.get(DATE).element as HTMLInputElement).value).toBe(
      "15.07.1979",
    );
    expect(wrapper.get(READING).text()).toBe("15 lipca 1979");
    expect(wrapper.get(SAVE).text()).toBe("Zapisz");
  });
});

type Brought = { show: () => void; focus: () => void };

/** For a page that sent the reader elsewhere, a sign-in from under the work
 * say, and brings them back. Focusing the field alone scrolls it only as far
 * as the window's edge, where the app bar, which stays at the top, can cover
 * it. */
describe("OswiadczeniaTaskCard brought back into the window", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the date field in the middle of the window, and leaves the caret where it was", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const wrapper = await mount();
    (document.activeElement as HTMLElement | null)?.blur();

    (wrapper.vm as unknown as Brought).show();

    const date = wrapper.get(DATE).element;
    expect(scrolled.mock.contexts).toEqual([date]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).not.toBe(date);
  });

  it("puts the caret in the date field once it is in the middle of the window, without scrolling it again", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const focused = vi.spyOn(HTMLElement.prototype, "focus");
    const wrapper = await mount();

    (wrapper.vm as unknown as Brought).focus();

    const date = wrapper.get(DATE).element;
    expect(scrolled.mock.contexts).toEqual([date]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(focused.mock.contexts).toEqual([date]);
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(date);
  });
});

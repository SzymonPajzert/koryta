import { describe, it, expect, afterEach, vi } from "vitest";
import { defineComponent, h, nextTick, shallowRef } from "vue";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import TaskCard from "../../../app/components/oswiadczenia/TaskCard.vue";
import type { DeclarationTask } from "../../../shared/declarations";

const task: DeclarationTask = {
  id: "crop-1",
  unit: "Testowice (gmina miejsko-wiejska)",
  office: "Rada gminy",
  declarationYear: 2019,
  documentUrl: "https://bip.gmina-testowa.example/oswiadczenie-1.pdf",
  host: "bip.gmina-testowa.example",
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
  vi.useRealTimers();
});

const DATE = '[data-testid="declaration-date-input"]';
const NAME = '[data-testid="declaration-name-input"]';
const READING = '[data-testid="declaration-reading"]';
const SKIP = '[data-testid="declaration-skip"]';
const SAVE = '[data-testid="declaration-submit"]';
const LINK = '[data-testid="declaration-document-link"]';

/** The card a reader reads one crop on, „jedno pole”, picked in round
 * bip-czytanie-r1. One field takes the date's eight digits, puts the dots in
 * itself and says back what it understood, so a slip of a digit is seen
 * before it is sent; one button beside it skips the crop until all eight are
 * typed and saves the date once they are, since part of a date is of no use
 * (his calls of 2026-10-30 and 2026-10-31). The name line and its field stay
 * off while readers are not asked for names (READ_NAMES);
 * TaskCard.names.test.ts keeps them working for the day they are. */
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
    // Nor the office, the unit or the year (round bip-czytanie-r3).
    expect(wrapper.text()).not.toContain("Testowice");
    expect(wrapper.text()).not.toContain("2019");
    // A label and the field's own „dd.mm.rrrr”, and no examples under it.
    expect(wrapper.get("label").text()).toBe("Data urodzenia");
    expect(wrapper.get(DATE).attributes("placeholder")).toBe("dd.mm.rrrr");
    expect(wrapper.get(READING).text()).toBe("");
  });

  // Its own, before it is answered: under the next crop, the one just
  // answered read as the next one's.
  it("links the whole declaration this crop was cut from, with its host", async () => {
    const wrapper = await mount();

    const link = wrapper.get(LINK);
    expect(link.text()).toBe("Zobacz całe oświadczenie");
    expect(link.attributes("href")).toBe(
      "https://bip.gmina-testowa.example/oswiadczenie-1.pdf",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener");
    expect(wrapper.text()).toContain("bip.gmina-testowa.example");
  });

  // The server checks the address at upload; the page that puts it in front
  // of a reader checks it again.
  it("links nothing that is not an http(s) address", async () => {
    const wrapper = await mount({
      task: {
        ...task,
        documentUrl: "javascript:alert(document.cookie)",
        host: null,
      },
    });

    expect(wrapper.find(LINK).exists()).toBe(false);
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Zobacz całe oświadczenie");
  });

  it("puts the dots in as the digits are typed, and says back the day they make", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("150719");
    expect((input.element as HTMLInputElement).value).toBe("15.07.19");
    // Part of a date, while it is typed: nothing to say yet.
    expect(wrapper.get(READING).text()).toBe("");

    await input.setValue("15071979");
    expect((input.element as HTMLInputElement).value).toBe("15.07.1979");
    expect(wrapper.get(READING).text()).toBe("15 lipca 1979");
    expect(wrapper.get(READING).classes()).toContain("ow-reading--ok");
  });

  // Keys as a keyboard sends them, one input event each.
  it("shows the dot after the day as soon as it is typed, and Backspace takes it with the day's last digit", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE).element as HTMLInputElement;
    const key = async (value: string, inputType: string, data?: string) => {
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { inputType, data }));
      await nextTick();
    };

    await key("1", "insertText", "1");
    await key("15", "insertText", "5");
    expect(input.value).toBe("15.");
    await key("15.0", "insertText", "0");
    await key("15.07", "insertText", "7");
    expect(input.value).toBe("15.07.");

    // The browser's Backspace takes the dot alone; the field takes the 7.
    await key("15.07", "deleteContentBackward");
    expect(input.value).toBe("15.0");
  });

  it("takes no letter into the field", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("15 VII 1979");
    expect((input.element as HTMLInputElement).value).toBe("15.19.79");
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

  it("skips when Enter is pressed in the empty field, as its button says", async () => {
    const wrapper = await mount();

    await wrapper.get(DATE).trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("answer")).toEqual([[task, { verdict: "skip" }]]);
  });

  it("keeps „Pomiń” until all eight digits are typed, and turns it into „Zapisz” then", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    for (const typed of ["1", "1507", "1507197"]) {
      await input.setValue(typed);
      expect(wrapper.get(SKIP).text()).toBe("Pomiń");
      expect(wrapper.find(SAVE).exists()).toBe(false);
    }

    await input.setValue("15071979");
    expect(wrapper.get(SAVE).text()).toBe("Zapisz");
    expect(wrapper.find(SKIP).exists()).toBe(false);

    // A digit taken back is a date short of whole again.
    await input.setValue("15.07.197");
    expect(wrapper.get(SKIP).text()).toBe("Pomiń");
  });

  // A reader who started on a line and cannot finish it moves on without
  // clearing the field: part of a date is of no use.
  it("skips the crop with „Pomiń” when only part of a date is typed", async () => {
    const wrapper = await mount();

    await wrapper.get(DATE).setValue("150719");
    await wrapper.get(SKIP).trigger("click");

    expect(wrapper.emitted("answer")).toEqual([[task, { verdict: "skip" }]]);
  });

  it("asks for all eight digits once the reader stops typing short of them", async () => {
    const wrapper = await mount();
    vi.useFakeTimers();
    const input = wrapper.get(DATE);

    await input.setValue("1507");
    await vi.advanceTimersByTimeAsync(2999);
    expect(wrapper.get(READING).text()).toBe("");

    await vi.advanceTimersByTimeAsync(1);
    const reading = wrapper.get(READING);
    expect(reading.text()).toBe("Wpisz wszystkie 8 cyfr.");
    // A hint, not a mistake: nothing was sent.
    expect(reading.classes()).toContain("ow-reading--hint");
    expect(input.classes()).not.toContain("ow-card__input--error");

    // Typing again takes it away until the reader stops again.
    await input.setValue("15071");
    expect(wrapper.get(READING).text()).toBe("");
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.get(READING).text()).toBe("Wpisz wszystkie 8 cyfr.");
  });

  // Enter saves everywhere else on the card, so pressed short of the whole
  // date it is a reader who thinks they are done, not one giving up.
  it("does not throw away part of a date on Enter, and says what is missing", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("1507197");
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("answer")).toBeUndefined();
    const reading = wrapper.get(READING);
    expect(reading.text()).toBe("Wpisz wszystkie 8 cyfr.");
    expect(reading.classes()).toContain("ow-reading--error");
    expect(input.classes()).toContain("ow-card__input--error");
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

  it("sends a typed date with „Zapisz” and with Enter, as YYYY-MM-DD", async () => {
    const wrapper = await mount();
    const input = wrapper.get(DATE);

    await input.setValue("15071979");
    await wrapper.get(SAVE).trigger("click");
    await input.trigger("keydown", { key: "Enter" });

    const sent = [task, { verdict: "date", value: "1979-07-15" }];
    expect(wrapper.emitted("answer")).toEqual([sent, sent]);
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

/** The card as the page holds it, through a template ref, which is what
 * sees what the card exposes. */
async function mountHeld() {
  const card = shallowRef<Brought | null>(null);
  const wrapper = await mountSuspended(
    defineComponent({ setup: () => () => h(TaskCard, { task, ref: card }) }),
    { attachTo: document.body },
  );
  mounted.push(wrapper);
  return { wrapper, card: card.value! };
}

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
    const { wrapper, card } = await mountHeld();
    (document.activeElement as HTMLElement | null)?.blur();

    card.show();

    const date = wrapper.get(DATE).element;
    expect(scrolled.mock.contexts).toEqual([date]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).not.toBe(date);
  });

  it("puts the caret in the date field once it is in the middle of the window, without scrolling it again", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const focused = vi.spyOn(HTMLElement.prototype, "focus");
    const { wrapper, card } = await mountHeld();

    card.focus();

    const date = wrapper.get(DATE).element;
    expect(scrolled.mock.contexts).toEqual([date]);
    expect(scrolled).toHaveBeenCalledWith({ block: "center" });
    expect(focused.mock.contexts).toEqual([date]);
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(date);
  });
});

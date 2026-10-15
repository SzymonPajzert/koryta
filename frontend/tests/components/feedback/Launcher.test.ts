import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import FeedbackLauncher from "../../../app/components/feedback/Launcher.vue";
import { useFeedbackDialog } from "~/composables/feedbackDialog";

/** Vuetify's `useDisplay()` reads `window.innerWidth` and follows `resize`, so
 * this is the width the launcher is drawn at, not a stand-in for it. */
const atWidth = async (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
  await nextTick();
};

const mountLauncher = async (props: { labelled?: boolean } = {}) => {
  const wrapper = await mountSuspended(FeedbackLauncher, { props });
  await nextTick();
  return wrapper;
};

type Wrapper = Awaited<ReturnType<typeof mountLauncher>>;
const desktop = (wrapper: Wrapper) =>
  wrapper.get("[data-testid='feedback-launcher']");
const phone = (wrapper: Wrapper) =>
  wrapper.get("[data-testid='feedback-launcher-phone']");

/** „Zgłoś” is an item of the app bar. It used to float in the bottom corner,
 * where on a phone it covered text at 38-62% of scroll positions. */
describe("FeedbackLauncher", () => {
  afterEach(async () => {
    await atWidth(1024);
    useFeedbackDialog().value = false;
  });

  /** Both forms are in the markup at every width and Vuetify's display classes
   * pick one. A width-driven `v-if` would not do: under SSR Vuetify assumes a
   * 1280px window, so a phone would get the desktop button in its html and
   * swap it on hydration. */
  it.each([
    ["a phone", 393],
    ["a desktop", 1280],
  ])(
    "draws both forms on %s and lets the display classes pick",
    async (_, width) => {
      await atWidth(width);
      const wrapper = await mountLauncher();

      expect(desktop(wrapper).classes()).toContain("hidden-sm-and-down");
      expect(phone(wrapper).classes()).toContain("hidden-md-and-up");
      // No floating button left beside them.
      expect(wrapper.find(".feedback-fab").exists()).toBe(false);
    },
  );

  it("says „Zgłoś” on a computer", async () => {
    expect(desktop(await mountLauncher()).text()).toBe("Zgłoś");
  });

  /** It was reported as „a dot” with no „Zgłoś” on it: the phone's button was
   * given `icon` and a default slot that rendered nothing, and VBtn draws the
   * slot rather than the icon whenever there is one - a blank circle. */
  it("draws its icon on a phone, never a blank circle", async () => {
    await atWidth(393);
    const button = phone(await mountLauncher());

    expect(button.find(".v-icon svg").exists()).toBe(true);
  });

  it("shows the icon and „Zgłoś” on a phone where the bar has room", async () => {
    // Home's bar, which has no search.
    await atWidth(393);
    const button = phone(await mountLauncher({ labelled: true }));

    expect(button.find(".v-icon svg").exists()).toBe(true);
    expect(button.text()).toBe("Zgłoś");
  });

  it("names what it opens for a screen reader, and that it is a dialog", async () => {
    for (const labelled of [false, true]) {
      const wrapper = await mountLauncher({ labelled });
      for (const button of [desktop(wrapper), phone(wrapper)]) {
        expect(button.attributes("aria-label")).toBe("Zgłoś błąd lub pomysł");
        expect(button.attributes("aria-haspopup")).toBe("dialog");
      }
    }
  });

  it("opens the one shared feedback dialog from either form", async () => {
    // Shared state, so the home call to action and /pomoc's card open the
    // dialog the bar has already mounted rather than a second copy of it.
    const open = useFeedbackDialog();
    const wrapper = await mountLauncher();

    await desktop(wrapper).trigger("click");
    expect(open.value).toBe(true);

    open.value = false;
    await phone(wrapper).trigger("click");
    expect(open.value).toBe(true);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import FeedbackLauncher from "../../../app/components/feedback/Launcher.vue";

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

const fab = async () => {
  const wrapper = await mountSuspended(FeedbackLauncher);
  await nextTick();
  return wrapper.find(".feedback-fab");
};

describe("FeedbackLauncher", () => {
  afterEach(() => atWidth(1024));

  /** It was reported as „a dot” with no „Zgłoś” on it: on a phone the button
   * was given `icon` and a default slot that rendered nothing, and VBtn draws
   * the slot rather than the icon whenever there is one - a blank circle. */
  it.each([
    ["a phone", 393],
    ["a desktop", 1280],
  ])("shows its icon and „Zgłoś” on %s", async (_, width) => {
    await atWidth(width);
    const button = await fab();

    expect(button.exists()).toBe(true);
    expect(button.find(".v-icon svg").exists()).toBe(true);
    expect(button.text()).toBe("Zgłoś");
  });

  it("names what it opens for a screen reader", async () => {
    const button = await fab();

    expect(button.attributes("aria-label")).toBe("Zgłoś błąd lub pomysł");
  });
});

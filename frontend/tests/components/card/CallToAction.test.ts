import { describe, it, expect } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import CallToAction from "../../../app/components/card/CallToAction.vue";

// Vuetify's tooltips observe their activator, and happy-dom ships no
// ResizeObserver. The section's own IntersectionObserver is not in happy-dom
// either, and it fires an analytics goal, so it is stubbed rather than left to
// throw on mount.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

let stats = { total: 100, approved: 40, reviewed: 30, toCheck: 30 };
registerEndpoint("/api/stats/progress", () => stats);

// `useStats()` does not await its `useAsyncData` - it is documented as zero
// until the request lands, which under SSR never shows and on a client-side
// navigation is one frame. `mountSuspended` resolves before that, so the flush
// is what puts the test on the far side of the fetch rather than in that frame.
const mount = async () => {
  const wrapper = await mountSuspended(CallToAction);
  await flushPromises();
  return wrapper;
};

/** The home page's one ask. It was reported by a first-time visitor as not
 * saying what it wanted - „«Zostało nam jeszcze dużo osób» – do czego?” - and
 * as offering two buttons that asked for the same thing in different words.
 * These pin the three things that answer her: the heading names the work, one
 * button is visibly the primary one, and the number beside it is the one that
 * grows. */
describe("CardCallToAction", () => {
  it("says what the people are still needed for", async () => {
    const wrapper = await mount();

    expect(wrapper.get("h2").text()).toContain("do sprawdzenia");
  });

  it("counts what has been checked, not what is merely unpublished", async () => {
    const wrapper = await mount();

    // approved + reviewed, out of total. The old copy printed `reviewed`
    // alone, which is the smallest of the three and *falls* every time
    // somebody publishes one of them.
    expect(wrapper.text()).toContain("70 z 100 osób");
  });

  it("offers exactly one primary button, and it leads to the queue", async () => {
    const wrapper = await mount();

    // Filled is what „primary” means here: the two beside it are text buttons,
    // so which one the section wants taken is visible before it is read.
    const filled = wrapper.findAll(".v-btn--variant-flat");
    expect(filled).toHaveLength(1);
    expect(filled[0]!.text()).toContain("Sprawdź pierwszą osobę");

    // Read off the props, not off `href`: with no router mounted a `v-btn` with
    // a `to` renders an `<a>` with no href at all, so an href assertion here
    // passes for a button that leads nowhere.
    const destinations = wrapper
      .findAllComponents({ name: "VBtn" })
      .map((btn) => btn.props("to"));
    expect(destinations).toContain("/eksploruj/nowe");
    expect(destinations).toContain("/pomoc");
  });

  it("has dropped the two asks that competed with each other", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).not.toContain("Albo zacznij działać");
    expect(wrapper.text()).not.toContain("znaleźliśmy już");
  });

  // The section used to render a skeleton whenever `total` was falsy, which
  // covers a *failed* /api/stats/progress as well as a slow one - and „/” has
  // `swr: 3600`, so an hour of readers would have got a bone where the page's
  // only ask should be. The ask does not depend on the numbers, so it no longer
  // waits for them.
  it("keeps the ask when the figures do not arrive, and never says „0 z 0”", async () => {
    stats = { total: 0, approved: 0, reviewed: 0, toCheck: 0 };
    // Every caller of `useStats()` shares one `useAsyncData` key, which is the
    // point of it - and it means the figures from the mount above are still
    // cached. Clearing the key is what makes this a second measurement rather
    // than a second look at the first one.
    clearNuxtData("site-progress");
    try {
      const wrapper = await mount();

      expect(wrapper.get("h2").text()).toContain("do sprawdzenia");
      expect(
        wrapper
          .findAllComponents({ name: "VBtn" })
          .map((btn) => btn.props("to")),
      ).toContain("/eksploruj/nowe");
      expect(wrapper.text()).not.toContain("0 z 0");
      expect(wrapper.text()).not.toContain("sprawdziliśmy dopiero");
    } finally {
      stats = { total: 100, approved: 40, reviewed: 30, toCheck: 30 };
      clearNuxtData("site-progress");
    }
  });

  it("opens the dialog the „Zgłoś” button already mounted", async () => {
    const wrapper = await mount();

    const report = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Zgłoś błąd"));
    expect(report).toBeDefined();

    // Not a link: it flips the shared state rather than navigating anywhere.
    expect(report!.attributes("href")).toBeUndefined();
  });
});

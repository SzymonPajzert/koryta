import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import { VTooltip } from "vuetify/components";
import * as directives from "vuetify/directives";
import InfoBubble from "../../app/components/InfoBubble.vue";

// Plain mount rather than `mountSuspended`: the bubble touches no Nuxt
// composable, so there is nothing here that needs an app around it.
const vuetify = createVuetify({ components, directives });

const mountBubble = (label = "Sprawdzanie osób", text = "Wyjaśnienie.") =>
  mount(InfoBubble, {
    global: { plugins: [vuetify] },
    props: { label },
    slots: { default: text },
  });

/** Answers `(hover: hover)` as a mouse (true) or a phone's finger (false)
 * would. */
function pointer(canHover: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(hover: hover)" && canHover,
        media: query,
      }) as MediaQueryList,
  );
}

/** The „(i)” that both entity sections and the help page hang their optional
 * half of an explanation on. It moved out of `PageSection` so the help page
 * could use it without a second hand-written copy, and these pin the details
 * that are easy to lose in a move: a phone has no hover, and a reader on a
 * keyboard has no pointer. */
describe("InfoBubble", () => {
  it("is reachable by keyboard and says what it explains", () => {
    const icon = mountBubble().get("[data-testid='section-info']");

    expect(icon.attributes("role")).toBe("button");
    expect(icon.attributes("tabindex")).toBe("0");
    expect(icon.attributes("aria-label")).toBe("Co to jest: Sprawdzanie osób");
  });

  it("opens on a click, because a phone never hovers", async () => {
    const wrapper = mountBubble(
      "Wesprzyj finansowo",
      "Nikt tu nie bierze pensji.",
    );

    // Nothing but the icon until it is asked for - that is the whole point of
    // hiding the sentence rather than printing it under the heading.
    expect(wrapper.text()).toBe("");

    await wrapper.get("[data-testid='section-info']").trigger("click");

    expect(document.body.textContent).toContain("Nikt tu nie bierze pensji.");
  });

  describe("on a phone", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // A tap sends an emulated hover and then a click: on a tooltip open on
    // both, the hover opened it and the click, a toggle, shut it again half a
    // second later. Where nothing hovers, the tap is the only way in.
    it("opens on hover only where the pointer can hover", async () => {
      pointer(true);
      const mouse = mountBubble();
      await nextTick();
      expect(mouse.findComponent(VTooltip).props("openOnHover")).toBe(true);

      pointer(false);
      const finger = mountBubble();
      await nextTick();
      expect(finger.findComponent(VTooltip).props("openOnHover")).toBe(false);
      expect(finger.findComponent(VTooltip).props("openOnClick")).toBe(true);
    });

    it("stays open after a tap", async () => {
      pointer(false);
      const wrapper = mountBubble("Zmiany na stanowisku", "Skąd te pary.");
      await nextTick();

      const icon = wrapper.get("[data-testid='section-info']");
      await icon.trigger("mouseenter");
      await icon.trigger("click");

      expect(
        wrapper.findComponent(VTooltip).emitted("update:modelValue"),
      ).toEqual([[true]]);
      expect(document.body.textContent).toContain("Skąd te pary.");
    });
  });
});

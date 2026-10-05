import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
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
});

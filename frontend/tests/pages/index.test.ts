import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import IndexPage from "../../app/pages/index.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

/** The page's one h1, as it reads. In the markup the one-letter „w” is tied to
 * the word after it with a no-break space, so it never ends a line on its own.
 * No full stop: it is a headline, not a sentence in a paragraph. */
const HEADLINE =
  "Sprawdzamy, którymi stanowiskami w publicznych spółkach podzielili się politycy";

async function mountPage() {
  const wrapper = mount(IndexPage, {
    global: {
      plugins: [vuetify],
      stubs: {
        HomeHeading: true,
        ChartPolandMap: true,
        CardCallToAction: true,
        ClientOnly: { template: "<div><slot></slot></div>" },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

describe("IndexPage", () => {
  it("leads with one h1 at every width, saying what the site does", async () => {
    const wrapper = await mountPage();

    expect(wrapper.html()).not.toContain("fallback");
    const headings = wrapper.findAll("h1");
    expect(headings).toHaveLength(1);
    const headline = headings[0]!;
    expect(headline.text().replace(/\u00a0/g, " ")).toBe(HEADLINE);
    expect(headline.text()).toContain("w\u00a0publicznych");
    // It used to be two: a claim beside the logo on a computer and this
    // sentence on a phone, each hidden at the other's width.
    expect(headline.classes().filter((name) => name.startsWith("d-"))).toEqual(
      [],
    );
  });

  it("no longer carries the claim it used to lead with", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).not.toContain("Jesteśmy największym");
  });

  it("asks for the newsletter above the call to action, in one section", async () => {
    const wrapper = await mountPage();

    const form = wrapper.get("[data-newsletter-signup]").element;
    const cta = wrapper.getComponent({ name: "CardCallToAction" }).element;
    expect(
      form.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // In the section rather than one of its own: a signed-in reader, who
    // gets no form, gets no empty gap where it would have been.
    expect(form.closest(".home-section")).toBe(cta.closest(".home-section"));
  });
});

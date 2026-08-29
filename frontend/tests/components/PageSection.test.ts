import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { mdiSwapVertical } from "@mdi/js";
import PageSection from "../../app/components/PageSection.vue";

// Plain mount rather than `mountSuspended`: the shell touches no Nuxt
// composable, so there is nothing here that needs an app around it.
const vuetify = createVuetify({ components, directives });

const mountSection = (
  props: Record<string, unknown> = { title: "Notatki" },
  slots: Record<string, string> = {},
) =>
  mount(PageSection, {
    global: { plugins: [vuetify] },
    props,
    slots,
  });

/** Every section of an entity page is drawn through this, so what it renders
 * is a contract four components and the e2e suite depend on. It exists because
 * those four each carried their own copy of these rules and the copies drifted
 * far enough for a reader to report, twice, that the notes did not belong on
 * the page. */
describe("PageSection", () => {
  it("heads itself with a title, and an icon only when given one", async () => {
    const bare = mountSection({ title: "Notatki" });
    expect(bare.get("h3").classes()).toContain("text-h6");
    expect(bare.get("h3").text()).toBe("Notatki");
    expect(bare.find(".sec-head__icon").exists()).toBe(false);

    const withIcon = mountSection({
      title: "Zmiany na stanowisku",
      icon: mdiSwapVertical,
    });
    expect(withIcon.find(".sec-head__icon").exists()).toBe(true);
  });

  it("carries a lead only when there is something to say", async () => {
    expect(mountSection().find(".k-lead").exists()).toBe(false);

    const withLead = mountSection({ title: "Notatki", lead: "Wiesz więcej?" });
    expect(withLead.get(".k-lead").text()).toBe("Wiesz więcej?");
  });

  // The slot form is what the sections with two lead paragraphs use, each with
  // its own testid. It is rendered unwrapped on purpose - a `<p>` nested in a
  // `<p>` is closed by the parser at the inner opening tag.
  it("takes a lead as a slot, unwrapped", async () => {
    const wrapper = mountSection(
      { title: "Zmiany na stanowisku" },
      {
        lead: '<p class="k-lead" data-testid="coverage">2 z 8</p><p class="k-lead">reszta</p>',
      },
    );

    expect(wrapper.findAll("p.k-lead")).toHaveLength(2);
    expect(wrapper.get("[data-testid='coverage']").text()).toBe("2 z 8");
  });

  // An empty `v-spacer` in a flex row is a full-width invisible column, so the
  // heading of a section with no controls must not get one.
  it("spaces the heading off from its controls, and only then", async () => {
    expect(mountSection().find(".v-spacer").exists()).toBe(false);

    const withActions = mountSection(
      { title: "Historia powiązań" },
      { actions: "<button>Dodaj</button>" },
    );
    expect(withActions.find(".sec-head .v-spacer").exists()).toBe(true);
    expect(withActions.get(".sec-head button").text()).toBe("Dodaj");
  });

  it("renders its entries, and hands the caller the section element", async () => {
    const wrapper = mountSection(
      { title: "Notatki" },
      { default: "<article class='k-card'>notatka</article>" },
    );

    expect(wrapper.get("article.k-card").text()).toBe("notatka");
    expect(wrapper.element.tagName).toBe("SECTION");
  });

  // The gap to the next section belongs to the page that stacks them, and the
  // e2e suite navigates by testid - both arrive as fall-through attributes,
  // and both have to survive alongside the shell's own `px-2`.
  it("keeps its own padding when the caller passes a class and a testid", async () => {
    const wrapper = mount(PageSection, {
      global: { plugins: [vuetify] },
      props: { title: "Fakty z artykułów" },
      attrs: { class: "mt-4", "data-testid": "person-extractions" },
    });

    expect(wrapper.classes()).toEqual(expect.arrayContaining(["px-2", "mt-4"]));
    expect(wrapper.attributes("data-testid")).toBe("person-extractions");
  });
});

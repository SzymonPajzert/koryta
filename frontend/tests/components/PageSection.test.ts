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
    // An h2: the section sits under the page's one h1, the entity's name.
    expect(bare.find("h3").exists()).toBe(false);
    expect(bare.get("h2").classes()).toContain("text-h6");
    expect(bare.get("h2").text()).toBe("Notatki");
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

  // The reader's complaint was not that the explanations are wrong but that
  // they are long („robi straszny bloat na stronie”), so the shell has a place
  // to put the half nobody has to read. No bubble where nothing was given, or
  // every heading on the site grows a decoration that says nothing.
  it("hides the rest of the explanation behind an info bubble", async () => {
    expect(mountSection().find("[data-testid='section-info']").exists()).toBe(
      false,
    );

    const withInfo = mountSection({
      title: "Notatki",
      info: "Notatki są publiczne.",
    });
    const bubble = withInfo.get("[data-testid='section-info']");
    // Reachable without a mouse: the tooltip opens on click and on focus, and
    // a bare `v-icon` is neither focusable nor named until it is told to be.
    expect(bubble.attributes("tabindex")).toBe("0");
    expect(bubble.attributes("aria-label")).toBe("Co to jest: Notatki");
    await bubble.trigger("click");
    expect(document.body.textContent).toContain("Notatki są publiczne.");
  });

  // The slot form, for an explanation that is a list rather than a sentence -
  // the notes' three worked examples.
  it("takes the info as a slot too", async () => {
    const wrapper = mountSection(
      { title: "Notatki" },
      { info: "<ul><li>Źródło - „Artykuł z marca 2023”</li></ul>" },
    );

    await wrapper.get("[data-testid='section-info']").trigger("click");
    expect(document.body.textContent).toContain("Artykuł z marca 2023");
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

  // The gap to the next section belongs to the page that stacks them
  // (`k-sections`), and the section shares the page's one left edge rather
  // than an 8px inset of its own: a class of the shell's would add to the
  // page's spacing instead of following it. What the caller passes - a block
  // that belongs to the one above keeps its `mt-4`, and the e2e suite
  // navigates by testid - arrives as fall-through attributes.
  it("has no inset or margin of its own, and takes the caller's class and testid", async () => {
    expect(mountSection().classes()).toEqual([]);

    const wrapper = mount(PageSection, {
      global: { plugins: [vuetify] },
      props: { title: "Fakty z artykułów" },
      attrs: { class: "mt-4", "data-testid": "person-extractions" },
    });

    expect(wrapper.classes()).toEqual(["mt-4"]);
    expect(wrapper.attributes("data-testid")).toBe("person-extractions");
  });

  // How much a section holds - „2 zmiany · 3 pominięte” - on the heading's
  // line, where a lead sentence used to spend a line of its own saying it.
  it("says how much it holds in a caption beside the heading", async () => {
    expect(mountSection().find(".sec-head__caption").exists()).toBe(false);

    const wrapper = mountSection({
      title: "Zmiany na stanowisku",
      caption: "2 zmiany · 3 pominięte",
      captionTestid: "person-successions-count",
    });

    const caption = wrapper.get(".sec-head .sec-head__caption");
    expect(caption.text()).toBe("2 zmiany · 3 pominięte");
    expect(caption.attributes("data-testid")).toBe("person-successions-count");
    // After the heading, on its line rather than under it.
    expect(caption.element.previousElementSibling?.tagName).toBe("H2");
  });

  it("takes the caption as a slot, for one that needs markup", async () => {
    const wrapper = mountSection(
      { title: "Obecny skład" },
      { caption: "stan na <time>24 października 2026</time>" },
    );

    expect(wrapper.get(".sec-head__caption time").text()).toBe(
      "24 października 2026",
    );
  });

  // The 8px between a heading and what it heads, the gap „Historia
  // powiązań” keeps: every section head on an entity page stands the same
  // distance over its first entry.
  it("stands its head 8px over what it heads", async () => {
    expect(mountSection().get(".sec-head").classes()).toContain("mb-2");
  });
});

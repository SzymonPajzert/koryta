import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PageHead from "../../../app/components/admin/PageHead.vue";

// Plain mount rather than `mountSuspended`, as for PageSection: the head
// touches no Nuxt composable, and it imports its bubble rather than relying on
// the auto-import, so a bare mount is the case it promises to work in.
const vuetify = createVuetify({ components, directives });

const mountHead = (
  props: Record<string, unknown> = { title: "Opinie" },
  slots: Record<string, string> = {},
) =>
  mount(PageHead, {
    global: { plugins: [vuetify] },
    props,
    slots,
  });

/** The top of every working page. Each of them used to write its own, and
 * they drifted - a title in the Vuetify size it predated type.css in, a lead
 * that ran to four sentences, a gap of whatever `mb-*` the page passed - so
 * what it renders is the contract the admin and working pages now share. */
describe("AdminPageHead", () => {
  it("is one h1 with the title, and nothing else when given nothing else", () => {
    const wrapper = mountHead({ title: "Opinie" });

    expect(wrapper.findAll("h1")).toHaveLength(1);
    expect(wrapper.get("h1").text()).toBe("Opinie");
    // No empty rows for slots nobody filled: an empty flex row still takes
    // its gap and margin, and the page would sit lower for nothing.
    expect(wrapper.find(".apage-head__back").exists()).toBe(false);
    expect(wrapper.find(".apage-head__actions").exists()).toBe(false);
    expect(wrapper.find(".k-page-lead").exists()).toBe(false);
    expect(wrapper.find("[data-testid='section-info']").exists()).toBe(false);
    expect(wrapper.text()).toBe("Opinie");
  });

  it("puts the one sentence under the title in the public pages' lead", () => {
    const wrapper = mountHead({
      title: "Opinie",
      lead: "Zgłoszenia czytelników, od najnowszych.",
    });

    const lead = wrapper.get(".k-page-lead");
    expect(lead.element.tagName).toBe("P");
    expect(lead.text()).toBe("Zgłoszenia czytelników, od najnowszych.");
    // The lead is not part of the heading.
    expect(wrapper.get("h1").text()).toBe("Opinie");
  });

  // The slot form is for a sentence that holds a link.
  it("takes the lead as a slot, inside the same paragraph", () => {
    const wrapper = mountHead(
      { title: "QA" },
      { lead: 'Zmiany do sprawdzenia - <a href="/admin/opinie">opinie</a>.' },
    );

    const leads = wrapper.findAll(".k-page-lead");
    expect(leads).toHaveLength(1);
    expect(leads[0]!.get("a").attributes("href")).toBe("/admin/opinie");
    expect(leads[0]!.text()).toBe("Zmiany do sprawdzenia - opinie.");
  });

  it("hides the rest of the explanation behind a bubble beside the title, not in it", async () => {
    const wrapper = mountHead({
      title: "Krawędzie do sprawdzenia",
      info: "Powiązania, których nikt jeszcze nie przejrzał.",
    });

    const bubble = wrapper.get("[data-testid='section-info']");
    expect(bubble.attributes("aria-label")).toBe(
      "Co to jest: Krawędzie do sprawdzenia",
    );
    // Outside the h1, so the heading's accessible name is the title alone -
    // a screen reader's list of headings would otherwise read „Krawędzie do
    // sprawdzenia, Co to jest: Krawędzie do sprawdzenia”.
    expect(
      wrapper.get("h1").find("[data-testid='section-info']").exists(),
    ).toBe(false);
    expect(wrapper.get("h1").text()).toBe("Krawędzie do sprawdzenia");
    // Not printed on the page until it is asked for.
    expect(wrapper.text()).not.toContain("nikt jeszcze nie przejrzał");

    await bubble.trigger("click");
    expect(document.body.textContent).toContain(
      "Powiązania, których nikt jeszcze nie przejrzał.",
    );
  });

  it("takes the bubble's text as a slot too", async () => {
    const wrapper = mountHead(
      { title: "Procesy" },
      { info: "<ul><li>Uruchomienia z ostatniej doby</li></ul>" },
    );

    const bubble = wrapper.get("[data-testid='section-info']");
    expect(
      wrapper.get("h1").find("[data-testid='section-info']").exists(),
    ).toBe(false);
    await bubble.trigger("click");
    expect(document.body.textContent).toContain(
      "Uruchomienia z ostatniej doby",
    );
  });

  it("puts the way back above the title and the page's buttons beside it", () => {
    const wrapper = mountHead(
      { title: "Kategoryzacja notatek" },
      {
        back: '<a href="/admin/notatki" data-back>Notatki</a><button data-undo>Cofnij</button>',
        actions: "<button data-action>Odśwież</button>",
      },
    );

    const back = wrapper.get(".apage-head__back");
    expect(back.find("[data-back]").attributes("href")).toBe("/admin/notatki");
    // „Cofnij” shares the back link's line rather than costing a phone a line
    // of its own.
    expect(back.find("[data-undo]").exists()).toBe(true);
    expect(back.find("h1").exists()).toBe(false);
    // Above the title: first in the header.
    expect(wrapper.get("header").element.firstElementChild).toBe(back.element);

    const actions = wrapper.get(".apage-head__actions");
    expect(actions.get("[data-action]").text()).toBe("Odśwież");
    expect(actions.find("h1").exists()).toBe(false);
    // Neither is part of the heading.
    expect(wrapper.get("h1").text()).toBe("Kategoryzacja notatek");
  });
});

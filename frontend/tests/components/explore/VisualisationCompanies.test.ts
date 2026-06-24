import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VisualisationCompanies from "../../../../app/components/explore/VisualisationCompanies.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

describe("VisualisationCompanies", () => {
  it("displays empty state when no companies are available", () => {
    const wrapper = mount(VisualisationCompanies, {
      global: { plugins: [vuetify] },
      props: {
        people: [],
      },
    });

    expect(wrapper.text()).toContain("Brak danych do wyświetlenia");
  });

  it("aggregates people into companies correctly", () => {
    const wrapper = mount(VisualisationCompanies, {
      global: { plugins: [vuetify] },
      props: {
        people: [
          {
            id: "1",
            name: "Jan Kowalski",
            companies: ["Firma A", "Firma B"],
            parties: ["PO"],
            elections: [],
            visibility: true,
          },
          {
            id: "2",
            name: "Anna Nowak",
            companies: ["Firma A"],
            parties: ["PiS"],
            elections: [],
            visibility: true,
          },
          {
            id: "3",
            name: "Piotr Wiśniewski",
            companies: ["Firma B"],
            parties: [],
            elections: [],
            visibility: true,
          },
        ] as any,
      },
    });

    // We expect "Firma A" to have 2 people, 2 affiliated
    // "Firma B" to have 2 people, 1 affiliated

    const cards = wrapper.findAll(".v-card");
    expect(cards.length).toBe(2);

    // Sorted by most politicized first:
    // Firma A: 2 affiliated
    // Firma B: 1 affiliated

    const firstCompanyText = cards[0].text();
    expect(firstCompanyText).toContain("Firma A");
    expect(firstCompanyText).toContain("100% upolityczniona");
    expect(firstCompanyText).toContain("(2 z 2 osób)");

    const secondCompanyText = cards[1].text();
    expect(secondCompanyText).toContain("Firma B");
    expect(secondCompanyText).toContain("50% upolityczniona");
    expect(secondCompanyText).toContain("(1 z 2 osób)");
  });

  it("renders correctly with person having multiple parties", () => {
    const wrapper = mount(VisualisationCompanies, {
      global: { plugins: [vuetify] },
      props: {
        people: [
          {
            id: "1",
            name: "Marek",
            companies: ["Test Corp"],
            parties: ["PO", "Nowa Lewica"],
            elections: [],
            visibility: true,
          },
        ] as any,
      },
    });

    const companyText = wrapper.text();
    expect(companyText).toContain("Test Corp");
    expect(companyText).toContain("100% upolityczniona");
    expect(companyText).toContain("(1 z 1 osób)");

    const segments = wrapper.findAll(".bar-segment");
    // 2 segments for 2 parties
    expect(segments.length).toBe(2);

    // Each party segment should be 50%
    const styles = segments.map((s) => s.attributes("style"));
    expect(styles[0]).toContain("width: 50%");
    expect(styles[1]).toContain("width: 50%");
  });

  it("handles people without parties correctly", () => {
    const wrapper = mount(VisualisationCompanies, {
      global: { plugins: [vuetify] },
      props: {
        people: [
          {
            id: "1",
            name: "Osoba Bezpartyjna",
            companies: ["Firma C"],
            parties: [],
            elections: [],
            visibility: true,
          },
        ] as any,
      },
    });

    const companyText = wrapper.text();
    expect(companyText).toContain("Firma C");
    expect(companyText).toContain("0% upolityczniona");
    expect(companyText).toContain("(0 z 1 osób)");

    const segments = wrapper.findAll(".bar-segment");
    // Only 1 segment for unaffiliated
    expect(segments.length).toBe(1);
    expect(segments[0].attributes("style")).toContain("width: 100%");
    // We can't strictly assert the background color due to how browsers parse it (rgb vs hex) but we know it's rendered
  });
});

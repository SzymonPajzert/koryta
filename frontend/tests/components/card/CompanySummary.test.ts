import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import CompanySummary from "../../../app/components/card/CompanySummary.vue";
import type { Company } from "../../../shared/model";

const company = {
  id: "chain-company",
  type: "place",
  name: "Firma Testowa",
  regonNumber: "123456785",
  nipNumber: "5260250274",
  krsNumber: "0000357114",
} as Company;

describe("CardCompanySummary", () => {
  it("keeps a register apart from its number", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });
    // The template writes this gap out: whitespace between two tags is dropped
    // by the compiler, and "REGON:123456785" reads as one long number. The
    // linked identifiers lose it the same way, hence KRS here too.
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("REGON: 123456785");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("NIP: 5260250274");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("KRS: 0000357114");
  });

  it("leads to the company's own page when asked to", async () => {
    // Hyphen-free id: /instytucja/<slug>-<id> reads the id back off the last
    // dash segment, so `chain-company` above would not round-trip.
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: { ...company, id: "ZBcdQ9tUxVyv0o1mnpLH" } as Company,
        location: "Powiat Testowy",
        linkToPage: true,
      },
    });

    const link = wrapper.find("a[href^='/instytucja/']");
    expect(link.attributes("href")).toBe(
      "/instytucja/firma-testowa-ZBcdQ9tUxVyv0o1mnpLH",
    );
    // The name keeps the ink colour it had as a heading, so the arrow is the
    // only thing saying this goes somewhere - and it is under the visual
    // suite's diff threshold, which is why it is asserted here instead.
    expect(link.find(".v-icon").exists()).toBe(true);
  });

  it("links its categories, since nothing around them is a link", async () => {
    // The one caller of ChipCompanyCategories that may: every other one puts
    // the chips inside a row that already links somewhere.
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: { ...company, categories: ["koleje"] } as Company,
        location: "Powiat Testowy",
      },
    });

    expect(wrapper.find("a.v-chip--link").exists()).toBe(true);
  });

  it("links the company's Wikipedia article when it has one", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: {
        company: {
          ...company,
          wikipedia: "https://pl.wikipedia.org/wiki/Energa",
        } as Company,
        location: "Powiat Testowy",
      },
    });

    const link = wrapper.find("[data-testid='company-wikipedia'] a");
    expect(link.attributes("href")).toBe(
      "https://pl.wikipedia.org/wiki/Energa",
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.text()).toContain("Artykuł z Wikipedii");
  });

  it("says nothing about Wikipedia when there is no article", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });

    expect(wrapper.find("[data-testid='company-wikipedia']").exists()).toBe(
      false,
    );
  });

  it("leaves the name as text on the company's own page", async () => {
    // place/DetailView renders this card as the heading of the page it links
    // to, and a heading that links to itself is a dead end.
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });

    expect(wrapper.find("a[href^='/instytucja/']").exists()).toBe(false);
  });
});

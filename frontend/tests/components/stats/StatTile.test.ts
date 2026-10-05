import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import StatTile from "../../../app/components/stats/StatTile.vue";

const mount = (to?: string) =>
  mountSuspended(StatTile, {
    props: { label: "Fakty z ekstrakcji", value: 1234, to },
  });

describe("StatsStatTile", () => {
  it("is a real link when it has somewhere to go", async () => {
    // The tile once passed the string 'NuxtLink' to `:is`, which rendered an
    // unresolved <nuxtlink to="..."> tag: underlined on hover, and no href for
    // a click to follow.
    const wrapper = await mount("/ekstrakcje");

    const link = wrapper.get("a.stat-tile");
    expect(link.attributes("href")).toBe("/ekstrakcje");
    expect(link.text()).toContain("Fakty z ekstrakcji");
    expect(wrapper.find("nuxtlink").exists()).toBe(false);
  });

  it("is plain text when it has nowhere to go", async () => {
    const wrapper = await mount();

    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.get("div.stat-tile").text()).toContain("Fakty z ekstrakcji");
  });
});

import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import CompositionBar from "../../../app/components/stats/CompositionBar.vue";
import type { CompositionSegment } from "../../../app/components/stats/CompositionBar.vue";

const segments: CompositionSegment[] = [
  {
    key: "approved",
    label: "Opublikowane",
    value: 30,
    color: "#2e7d32",
    to: "/eksploruj/tabela?visibility=public",
  },
  { key: "unknown", label: "Nie wiadomo", value: 70, color: "#cccccc" },
];

describe("StatsCompositionBar", () => {
  it("makes a segment with a `to` a real link, and leaves the rest alone", async () => {
    // Segments once passed the string 'NuxtLink' to `:is`, which rendered an
    // unresolved <nuxtlink to="..."> tag - the bar on /eksploruj/statystyki
    // looked clickable and went nowhere.
    const wrapper = await mountSuspended(CompositionBar, {
      props: { segments, summary: "Podział osób" },
    });

    const drawn = wrapper.findAll(".composition-bar__segment");
    expect(drawn).toHaveLength(2);
    expect(drawn[0]!.element.tagName).toBe("A");
    expect(drawn[0]!.attributes("href")).toBe(
      "/eksploruj/tabela?visibility=public",
    );
    // The tooltip's activator props go through NuxtLink onto the anchor, so
    // the linked segment still shows its count on hover.
    expect(drawn[0]!.attributes("aria-describedby")).toMatch(/^v-tooltip-/);
    expect(drawn[1]!.element.tagName).toBe("DIV");
    expect(wrapper.find("nuxtlink").exists()).toBe(false);
  });
});

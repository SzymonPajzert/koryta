import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import PeopleBar from "../../../app/components/oswiadczenia/PeopleBar.vue";
import CompositionBar from "../../../app/components/stats/CompositionBar.vue";
import { ink, status } from "../../../app/utils/chartTheme";
import { role } from "../../../shared/colors";
import type { DeclarationPeople } from "../../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../../scripts/declarationPeople";

// Vuetify's tooltips on the segments observe their activators.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const people = seeded as DeclarationPeople;

type Segment = {
  key: string;
  label: string;
  value: number;
  color: string;
  to?: string;
};

/** The segments the bar hands the composition bar, in order. */
async function segmentsOf(detail?: "groups" | "stages") {
  const wrapper = await mountSuspended(PeopleBar, {
    props: { people, ...(detail ? { detail } : {}) },
  });
  const bar = wrapper.findComponent(CompositionBar);
  return {
    wrapper,
    segments: bar.props("segments") as Segment[],
  };
}

describe("OswiadczeniaPeopleBar", () => {
  it("groups the people for readers, published in the tally's green", async () => {
    const { segments } = await segmentsOf();
    expect(segments.map((s) => [s.key, s.value])).toEqual([
      ["published", 300],
      ["underway", 740],
      ["searching", 110],
    ]);
    // The colour of the published-a-day columns beside it on the panel.
    expect(segments[0]!.color).toBe(role.tally);
    expect(segments.at(-1)!.color).toBe(ink.track);
  });

  it("spells out every stage for the admin in the states' colours", async () => {
    const { segments } = await segmentsOf("stages");
    expect(segments.map((s) => s.key)).toEqual([
      "published",
      "held",
      "mismatched",
      "reading",
      "cropped",
      "downloaded",
      "searching",
    ]);
    expect(segments[0]!.color).toBe(status.good);
    // What waits on an admin leads to its list on the page.
    expect(segments.find((s) => s.key === "held")!.to).toBe("#wstrzymane");
    expect(segments.find((s) => s.key === "mismatched")!.to).toBe("#inna-data");
  });

  it("leaves the namesakes out of the bar and says them apart", async () => {
    for (const detail of ["groups", "stages"] as const) {
      const { wrapper, segments } = await segmentsOf(detail);
      const inBar = segments.reduce((sum, s) => sum + s.value, 0);
      expect(inBar).toBe(people.people - people.namesakes);
      expect(wrapper.text()).toContain("osobno imiennicy:");
      expect(wrapper.text()).toContain("50");
    }
  });

  it("links the namesakes to their list on the admin page only", async () => {
    const admin = (await segmentsOf("stages")).wrapper;
    expect(admin.find('.pbar__apart a[href="#inna-data"]').exists()).toBe(true);
    const reader = (await segmentsOf("groups")).wrapper;
    expect(reader.find(".pbar__apart a").exists()).toBe(false);
  });
});

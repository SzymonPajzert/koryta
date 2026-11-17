import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { defineComponent, h, type PropType } from "vue";
import IndexPage from "../../app/pages/index.vue";
import type { DeclarationPeople } from "../../shared/declarations";
import type { HomeTimelineResponse } from "../../server/api/stats/homeTimeline.get";
import { SEEDED_DECLARATION_PEOPLE as seededPeople } from "../../scripts/declarationPeople";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

/** The night's people count the page fetches for the explorer's third
 * panel: null before the job's first night. */
let people: DeclarationPeople | null = null;
registerEndpoint("/api/declarations/people", () => ({ people }));

/** The chart's counts, which the page fetches with itself rather than leaving
 * to the panel. */
const TIMELINE: HomeTimelineResponse = {
  months: ["2026-11"],
  groupings: {
    party: [{ key: "PO", label: "PO", counts: [4] }],
    region: [],
    category: [],
  },
  coverage: {
    party: { posts: 4, people: 4 },
    region: { posts: 0, people: 0 },
    category: { posts: 0, people: 0 },
  },
  posts: 4,
  today: "2026-11",
};
registerEndpoint("/api/stats/homeTimeline", () => TIMELINE);

/** Says what the page handed the explorer, in place of the map and charts. */
const ExplorerStub = defineComponent({
  name: "HomeExplorer",
  props: {
    people: { type: Object as PropType<object | null>, default: null },
    timeline: {
      type: Object as PropType<HomeTimelineResponse | null>,
      default: null,
    },
  },
  setup: (props) => () =>
    h("div", {
      "data-explorer": "",
      "data-people": props.people ? "yes" : "no",
      "data-timeline-posts": props.timeline?.posts ?? "none",
    }),
});

const mount = () =>
  mountSuspended(IndexPage, {
    global: {
      stubs: {
        HomeExplorer: ExplorerStub,
        HomeEventFeed: true,
        CardCallToAction: true,
        MailNewsletterSignupForm: true,
        OmniSearch: true,
        "omni-search": true,
      },
    },
  });

beforeEach(() => {
  people = null;
  // useFetch keeps the answer under its key between mounts.
  clearNuxtData("declarations-people");
  clearNuxtData("home-timeline");
});

describe("IndexPage", () => {
  it("renders correctly", async () => {
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.html()).not.toContain("fallback");
    expect(wrapper.html()).toContain(
      "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem",
    );
  });

  it("hands the explorer the night's people count", async () => {
    people = seededPeople as DeclarationPeople;
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.get("[data-explorer]").attributes("data-people")).toBe(
      "yes",
    );
  });

  it("hands the explorer the chart's counts with the page", async () => {
    const wrapper = await mount();
    await flushPromises();
    expect(
      wrapper.get("[data-explorer]").attributes("data-timeline-posts"),
    ).toBe("4");
  });

  it("keeps the explorer at two panels before the first count", async () => {
    const wrapper = await mount();
    await flushPromises();
    expect(wrapper.get("[data-explorer]").attributes("data-people")).toBe("no");
  });
});

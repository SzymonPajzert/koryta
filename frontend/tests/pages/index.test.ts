import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import IndexPage from "../../app/pages/index.vue";
import { ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Mock useEntity
const mockPeople = ref({});
vi.stubGlobal("useEntity", () =>
  Promise.resolve({
    entities: mockPeople,
  }),
);

// Mock useFeminatyw
vi.stubGlobal("useFeminatyw", () => ({
  koryciarz: {
    plural: {
      genitive: "koryciarzy",
    },
  },
}));

// Mock useHead (Nuxt)
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("useSeoMeta", vi.fn());

describe("IndexPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders correctly", async () => {
    const wrapper = mount(IndexPage, {
      global: {
        plugins: [vuetify],
        stubs: {
          HomeHero: true,
          HomeIntro: true,
          HomeHeading: true,
          HomeSourceCards: true,
          ChartPolandMap: true,
          HomeCard: {
            template: '<div><slot name="header"></slot><slot></slot></div>',
          },
          CardCallToAction: true,
          "omni-search-fake": true,
          ChartTreemapParty: true,
          CardHomeItem: {
            template: '<div><slot name="header"></slot><slot></slot></div>',
          },
          ClientOnly: { template: "<div><slot></slot></div>" },
        },
      },
    });

    await flushPromises();
    expect(wrapper.html()).not.toContain("fallback");
    expect(wrapper.html()).toContain(
      "Jesteśmy największym, ogólnopolskim i niezależnym agregatorem",
    );
  });
});

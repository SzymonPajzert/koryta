import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import IndexPage from "../../app/pages/index.vue";
import { defineComponent, h, Suspense, ref } from "vue";
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
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(IndexPage),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify],
          stubs: {
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
      },
    );

    await flushPromises();
    expect(wrapper.text()).toContain("Polskie partie oskarżają się");
  });
});

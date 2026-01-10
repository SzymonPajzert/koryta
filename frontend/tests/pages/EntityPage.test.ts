import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import EntityPage from "../../app/pages/entity/[destination]/[id].vue";
import { defineComponent, h, Suspense, ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";

import { useAuthState } from "~/composables/auth";
import { useEdges } from "~/composables/edges";

const vuetify = createVuetify({
  components,
  directives,
});

const QuickAddArticleButtonStub = {
  name: "QuickAddArticleButton",
  template: '<div class="quick-add-stub">Quick Add</div>',
  props: ["nodeId"],
};

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(),
}));

vi.mock("~/composables/edges", () => ({
  useEdges: vi.fn(),
}));

const { mockUseRoute } = vi.hoisted(() => {
  return { mockUseRoute: vi.fn() };
});
mockNuxtImport("useRoute", () => {
  return mockUseRoute;
});

describe("Entity Page - Add Article Button Visibility", () => {
  // Mocks
  const mockAuthFetch = vi.fn();

  beforeEach(() => {
    // Default implementations
    vi.mocked(useAuthState).mockReturnValue({
      authFetch: mockAuthFetch,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Helper to mount the page
  const mountPage = async (destination: string) => {
    // Setup Route Params
    mockUseRoute.mockReturnValue({
      params: {
        destination: destination,
        id: "123",
      },
    });

    // Setup Data Mocks
    // authFetch returns { data } ref
    mockAuthFetch.mockResolvedValue({
      data: ref({ node: { name: "Test Entity", content: "...", parties: [] } }),
    });

    // useEdges returns Promise<{ sources, targets, referencedIn }>
    vi.mocked(useEdges).mockResolvedValue({
      sources: ref([]),
      targets: ref([]),
      referencedIn: ref([]),
    } as any);

    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(EntityPage),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify],
          stubs: {
            QuickAddArticleButton: QuickAddArticleButtonStub,
            PartyChip: true,
            VoteWidget: true,
            CardShortNode: true,
            "router-link": true,
          },
        },
      },
    );
    await flushPromises();
    return wrapper;
  };

  it("renders QuickAddArticleButton when type is person", async () => {
    const wrapper = await mountPage("person");
    expect(wrapper.findComponent(QuickAddArticleButtonStub).exists()).toBe(
      true,
    );
  });

  it("renders QuickAddArticleButton when type is place", async () => {
    const wrapper = await mountPage("place");
    expect(wrapper.findComponent(QuickAddArticleButtonStub).exists()).toBe(
      true,
    );
  });

  it("does NOT render QuickAddArticleButton when type is article", async () => {
    const wrapper = await mountPage("article");
    expect(wrapper.findComponent(QuickAddArticleButtonStub).exists()).toBe(
      false,
    );
  });
});

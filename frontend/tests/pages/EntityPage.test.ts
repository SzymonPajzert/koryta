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
      query: {},
    });

    // Setup Data Mocks
    // authFetch returns { data } ref
    mockAuthFetch.mockImplementation(async (url) => {
      if (url.includes("/api/nodes/")) {
        return {
          data: ref({
            node: { name: "Test Entity", content: "...", parties: [] },
          }),
        };
      }
      if (url.includes("/api/comments/list")) {
        return {
          data: ref([]),
          pending: ref(false),
          refresh: vi.fn(),
        };
      }
      return { data: ref(null) };
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
            GraphCanvas: true, // Stub GraphCanvas to avoid data fetching issues
            FormEditEdge: true,
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

  describe("Region Type Restrictions", () => {
    it("does NOT render edit or remove buttons when type is region", async () => {
      const wrapper = await mountPage("region");
      const buttons = wrapper.findAll(".v-btn");

      // Zaproponuj zmianę button
      const changeBtn = buttons.find((b) =>
        b.text().includes("Zaproponuj zmianę"),
      );
      expect(changeBtn).toBeUndefined();

      // Zaproponuj usunięcie button
      const removeBtn = buttons.find((b) =>
        b.text().includes("Zaproponuj usunięcie"),
      );
      expect(removeBtn).toBeUndefined();

      // QuickAddArticleButton
      expect(wrapper.findComponent(QuickAddArticleButtonStub).exists()).toBe(
        false,
      );
    });

    it("renders edit and remove buttons for non-region types", async () => {
      const wrapper = await mountPage("person");
      const buttons = wrapper.findAll(".v-btn");

      const changeBtn = buttons.find((b) =>
        b.text().includes("Zaproponuj zmianę"),
      );
      expect(changeBtn).toBeDefined();

      const removeBtn = buttons.find((b) =>
        b.text().includes("Zaproponuj usunięcie"),
      );
      expect(removeBtn).toBeDefined();
    });
  });

  describe("Inline Edge Edition", () => {
    it("renders quick add buttons only for authenticated users", async () => {
      // Logged out
      vi.mocked(useAuthState).mockReturnValue({
        authFetch: mockAuthFetch,
        user: ref(null),
      } as any);
      let wrapper = await mountPage("person");
      expect(wrapper.text()).not.toContain("Szybkie dodawanie");

      // Logged in
      vi.mocked(useAuthState).mockReturnValue({
        authFetch: mockAuthFetch,
        user: ref({ uid: "123" }),
      } as any);
      wrapper = await mountPage("person");
      expect(wrapper.text()).toContain("Szybkie dodawanie");
      expect(wrapper.find('[data-testid^="edge-picker-"]').exists()).toBe(true);
    });

    it("opens FormEditEdge when a quick add button is clicked", async () => {
      vi.mocked(useAuthState).mockReturnValue({
        authFetch: mockAuthFetch,
        user: ref({ uid: "123" }),
      } as any);
      const wrapper = await mountPage("person");

      // Find the button "Dodaj gdzie ... pracuje" which is "edge-picker-employed"
      const btn = wrapper.find('[data-testid="edge-picker-employed"]');
      expect(btn.exists()).toBe(true);

      // Initially FormEditEdge should not be visible (it's in a v-if="editedEdge")
      expect(wrapper.findComponent({ name: "FormEditEdge" }).exists()).toBe(
        false,
      );

      await btn.trigger("click");

      // Now it should be visible
      const form = wrapper.findComponent({ name: "FormEditEdge" });
      expect(form.exists()).toBe(true);
    });
  });
});

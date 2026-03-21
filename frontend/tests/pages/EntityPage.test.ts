import { describe, it, expect } from "vitest";
import EntityPage from "#components";
import { ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { mountSuspended } from "@nuxt/test-utils/runtime";

const vuetify = createVuetify({
  components,
  directives,
});

const QuickAddArticleButtonStub = {
  name: "QuickAddArticleButton",
  template: '<div class="quick-add-stub">Quick Add</div>',
  props: ["nodeId"],
};

describe.todo("Entity Page - Add Article Button Visibility", () => {
  // Helper to mount the page
  const mountPage = async (destination: string) => {
    const component = await mountSuspended(EntityPage, {
      global: { plugins: [vuetify] },
      props: {
        destination,
      },
    });
    return component;
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

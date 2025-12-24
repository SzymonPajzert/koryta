import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OpenAbstractDialog from "../../app/components/OpenAbstractDialog.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ref } from "vue";

const vuetify = createVuetify({ components, directives });

// Mocks
const mockUser = ref(null);
const mockOpen = vi.fn();

vi.mock("@/composables/auth", () => ({
  useAuthState: () => ({ user: mockUser }),
}));

vi.mock("@/stores/dialog", () => ({
  useDialogStore: () => ({ open: mockOpen }),
}));

vi.mock("~~/shared/model", () => ({
  nodeTypeIcon: { person: "mdi-account" },
  destinationAddText: { person: "Add Person" },
}));

describe("OpenAbstractDialog", () => {
    it("renders link to login when not logged in", () => {
        mockUser.value = null;
        const wrapper = mount(OpenAbstractDialog, {
            global: { plugins: [vuetify] },
            props: { dialog: "person" as any }
        });
        
        const item = wrapper.findComponent(components.VListItem);
        expect(item.props("to")).toBe("/login");
        expect(item.text()).toContain("Add Person");
    });

    it("renders clickable item when logged in", async () => {
        mockUser.value = { uid: "123" } as any;
        const wrapper = mount(OpenAbstractDialog, {
            global: { plugins: [vuetify] },
            props: { dialog: "person" as any }
        });

        const item = wrapper.findComponent(components.VListItem);
        expect(item.props("to")).toBeUndefined();
        
        await item.trigger("click");
        expect(mockOpen).toHaveBeenCalledWith({ type: "person" });
    });
});

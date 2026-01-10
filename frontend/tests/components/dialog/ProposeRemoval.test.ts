import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ProposeRemoval from "@/components/dialog/ProposeRemoval.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

// Mock auth
const authFetchMock = vi.fn();
vi.mock("@/composables/auth", () => ({
  useAuthState: () => ({
    authFetch: authFetchMock,
  }),
}));

const vuetify = createVuetify({
  components,
  directives,
});

// Polyfill ResizeObserver
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

global.visualViewport = {
  width: 1000,
  height: 1000,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as any;

describe("ProposeRemoval.vue", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it("renders the activator button correctly", () => {
    const wrapper = mount(ProposeRemoval, {
      props: {
        id: "123",
        type: "person",
        name: "Test Person",
      },
      global: {
        plugins: [vuetify],
      },
    });

    expect(wrapper.text()).toContain("Zaproponuj usunięcie");
  });

  it("submits the removal proposal", async () => {
    const wrapper = mount(ProposeRemoval, {
      props: {
        id: "123",
        type: "person",
        name: "Test Person",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const vm = wrapper.vm as any;
    // Simulate opening dialog and setting reason directly to avoid Vuetify interaction complexity
    vm.dialog = true;
    vm.reason = "Duplicate entry";

    // Mock successful fetch
    authFetchMock.mockResolvedValue({});

    await vm.submit();

    expect(authFetchMock).toHaveBeenCalledWith("/api/revisions/create", {
      method: "POST",
      body: {
        node_id: "123",
        deleted: true,
        delete_reason: "Duplicate entry",
        collection: "nodes",
        type: "person",
        name: "Test Person",
      },
    });

    expect(wrapper.emitted("success")).toBeTruthy();
    expect(vm.dialog).toBe(false);
  });

  it("handles errors during submission", async () => {
    const wrapper = mount(ProposeRemoval, {
      props: {
        id: "123",
        type: "person",
        name: "Test Person",
      },
      global: {
        plugins: [vuetify],
      },
    });

    const vm = wrapper.vm as any;
    vm.dialog = true;
    vm.reason = "Duplicate entry";

    // Mock failed fetch
    authFetchMock.mockRejectedValue(new Error("Network fail"));

    await vm.submit();

    expect(authFetchMock).toHaveBeenCalled();
    expect(vm.error).toBe("Network fail");
    expect(vm.dialog).toBe(true); // Should stay open
  });
});

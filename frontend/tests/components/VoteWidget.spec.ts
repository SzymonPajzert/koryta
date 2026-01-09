// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import VoteWidget from "@/components/VoteWidget.vue";
import type { Node } from "~~/shared/model";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Mock auth
const userRef = ref({ uid: "test-user" });
const idTokenRef = ref("mock-token");

vi.mock("@/composables/auth", () => ({
  useAuthState: () => ({
    user: userRef,
    idToken: idTokenRef,
  }),
}));

// Mock keys hoisted
const mocks = vi.hoisted(() => {
  return {
    useDocument: vi.fn(),
    fetch: vi.fn(),
  };
});

// Mock VueFire and Firebase
// Default to null (no document yet)
mocks.useDocument.mockReturnValue(ref(null));

vi.mock("vuefire", () => ({
  useFirebaseApp: vi.fn(),
  useDocument: mocks.useDocument,
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
}));

const pushMock = vi.fn();
const routeMock = { fullPath: "/test-path" };

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => routeMock,
}));

// Mock global $fetch
global.$fetch = mocks.fetch;

describe("VoteWidget", () => {
  const entity: Node = {
    id: "1",
    name: "Test Node",
    type: "person",
    votes: {
      interesting: { total: 5, "test-user": 1, "other-user": 1 },
      quality: { total: 2, "other-user": 1 },
    },
  };

  it("renders correctly with initial votes from props", () => {
    mocks.useDocument.mockReturnValue(ref(null)); // Ensure no live doc initially

    const wrapper = mount(VoteWidget, {
      global: {
        plugins: [vuetify],
      },
      props: {
        entity,
        type: "node",
      },
    });

    // Check if score is displayed in the disabled button (index 1 in group)
    const buttons = wrapper.findAllComponents(components.VBtn);
    // Group 1: Tak, Count, Nie. Group 2: Gotowe, Count, Popraw.
    // Interesting count is at index 1
    expect(buttons[1].text()).toContain("1"); // User vote is 1

    // Check if "Tak" button is active (flat variant)
    // buttons[0] is "Tak"
    expect(buttons[0].props("variant")).toBe("flat");
  });

  it("calls vote API on click and activates subscription", async () => {
    mocks.useDocument.mockReturnValue(ref(null));
    mocks.fetch.mockResolvedValue({});

    const wrapper = mount(VoteWidget, {
      global: {
        plugins: [vuetify],
      },
      props: {
        entity,
        type: "node",
      },
    });

    // Click "Nie" (vote -1)
    // buttons[2] is "Nie"
    const buttons = wrapper.findAllComponents(components.VBtn);
    const nieBtn = buttons[2];
    await nieBtn.trigger("click");

    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/votes/vote",
      expect.objectContaining({
        method: "POST",
        body: {
          id: "1",
          type: "node",
          category: "interesting",
          vote: -1,
        },
        headers: {
          Authorization: "Bearer mock-token",
        },
      }),
    );

    // Verify subscription logic
    // Simulate live update
    const liveStats = {
      votes: {
        interesting: { total: 100, "test-user": -1 }, // Updated from live
        quality: { total: 200 },
      },
    };
    mocks.useDocument.mockReturnValue(ref(liveStats));
  });

  it("redirects to login if user is not logged in", async () => {
    // Mock user as null
    userRef.value = null;

    // reset mock
    pushMock.mockClear();
    routeMock.fullPath = "/current-page";

    const wrapper = mount(VoteWidget, {
      global: {
        plugins: [vuetify],
      },
      props: {
        entity,
        type: "node",
      },
    });

    const buttons = wrapper.findAllComponents(components.VBtn);
    const takBtn = buttons[0];
    await takBtn.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/current-page" },
    });

    // Cleanup mocks
    userRef.value = { uid: "test-user" } as any;
  });
});

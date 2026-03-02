import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import VoteWidget from "~/components/VoteWidget.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ref } from "vue";

const vuetify = createVuetify({
  components,
  directives,
});

const mockIdToken = ref<string | null>("test-token");
const mockUser = ref<{ uid: string } | null>({ uid: "test-user-id" });

vi.mock("~/composables/auth", () => ({
  useAuthState: vi.fn(() => ({
    idToken: mockIdToken,
    user: mockUser,
  })),
}));

vi.mock("vuefire", () => ({
  useFirebaseApp: vi.fn(),
  useDocument: vi.fn(() => ref(null)), // Simulation of not receiving realtime updates initially
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
}));

const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ fullPath: "/mock-path" }),
}));

describe("VoteWidget", () => {
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({});
    vi.stubGlobal("$fetch", mockFetch);

    // Reset auth state
    mockIdToken.value = "test-token";
    mockUser.value = { uid: "test-user-id" };
  });

  const mountWidget = (entityProps = {}) => {
    return mount(VoteWidget, {
      props: {
        type: "node",
        entity: {
          id: "node-123",
          name: "Test Node",
          votes: {
            interesting: { total: 0 },
            quality: { total: 0 },
          },
          ...entityProps,
        } as any,
      },
      global: {
        plugins: [vuetify],
      },
    });
  };

  it("renders correctly", () => {
    const wrapper = mountWidget();
    expect(wrapper.text()).toContain("Ciekawe?");
    expect(wrapper.text()).toContain("Jakość");
  });

  it("sends a Tak vote for interesting category", async () => {
    const wrapper = mountWidget();
    const buttons = wrapper.findAll(".v-btn");
    const takButton = buttons.find((b) => b.text().includes("Tak"));

    expect(takButton).toBeDefined();
    await takButton?.trigger("click");
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/votes/vote",
      expect.objectContaining({
        method: "POST",
        body: {
          id: "node-123",
          type: "node",
          category: "interesting",
          vote: 1,
        },
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("sends a Nie vote for interesting category", async () => {
    const wrapper = mountWidget();
    const buttons = wrapper.findAll(".v-btn");
    const nieButton = buttons.find((b) => b.text().includes("Nie"));

    expect(nieButton).toBeDefined();
    await nieButton?.trigger("click");
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/votes/vote",
      expect.objectContaining({
        method: "POST",
        body: {
          id: "node-123",
          type: "node",
          category: "interesting",
          vote: -1,
        },
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("sends a Gotowe vote for quality category", async () => {
    const wrapper = mountWidget();
    const buttons = wrapper.findAll(".v-btn");
    const gotoweButton = buttons.find((b) => b.text().includes("Gotowe"));

    expect(gotoweButton).toBeDefined();
    await gotoweButton?.trigger("click");
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/votes/vote",
      expect.objectContaining({
        method: "POST",
        body: { id: "node-123", type: "node", category: "quality", vote: 1 },
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("redirects to login when unauthenticated user tries to vote", async () => {
    // Unauthenticate user
    mockIdToken.value = null;
    mockUser.value = null;

    const wrapper = mountWidget();
    const buttons = wrapper.findAll(".v-btn");
    const takButton = buttons.find((b) => b.text().includes("Tak"));

    await takButton?.trigger("click");
    await flushPromises();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/mock-path" },
    });
  });
});

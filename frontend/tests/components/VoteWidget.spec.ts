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
const authFetchMock = vi.fn();
const userRef = ref({ uid: "test-user" });

vi.mock("@/composables/auth", () => ({
  useAuthState: () => ({
    authFetch: authFetchMock,
    user: userRef,
  }),
}));

const pushMock = vi.fn();
const routeMock = { fullPath: "/test-path" };

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock }),
  useRoute: () => routeMock,
}));

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

  it("renders correctly with initial votes", () => {
    const wrapper = mount(VoteWidget, {
      global: {
        plugins: [vuetify],
      },
      props: {
        entity,
        type: "node",
      },
    });

    expect(wrapper.text()).toContain("Wynik: 5");
    expect(wrapper.text()).toContain("Wynik: 2");
    // Check if "Tak" button is active (flat variant)
    const takBtn = wrapper
      .findAllComponents(components.VBtn)
      .find((b) => b.text() === "Tak");
    expect(takBtn?.props("variant")).toBe("flat");
  });

  it("calls vote API on click and updates optimistic state", async () => {
    const localEntity = {
      ...entity,
      votes: JSON.parse(JSON.stringify(entity.votes)),
    };

    const wrapper = mount(VoteWidget, {
      global: {
        plugins: [vuetify],
      },
      props: {
        entity: localEntity,
        type: "node",
      },
    });

    authFetchMock.mockResolvedValue({});

    // Click "Nie" (change vote from 1 to -1)
    const nieBtn = wrapper
      .findAllComponents(components.VBtn)
      .find((b) => b.text() === "Nie");
    await nieBtn?.trigger("click");

    expect(authFetchMock).toHaveBeenCalledWith(
      "/api/votes/vote",
      expect.objectContaining({
        method: "POST",
        body: {
          id: "1",
          type: "node",
          category: "interesting",
          vote: -1,
        },
      }),
    );

    // Optimistic update check
    // Original total was 5 (votes: 1 (me), 1 (other) -> sum is 2? Wait context: 3 others + 1 me + 1 other = 5)
    // Actually provided votes are: "test-user": 1, "other-user": 1. Total says 5.
    // If I change 1 to -1. Diff is -2.
    // Total should be 3.
    // My vote should be -1.

    expect(localEntity.votes.interesting.total).toBe(3);
    expect(localEntity.votes.interesting["test-user"]).toBe(-1);
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

    const takBtn = wrapper
      .findAllComponents(components.VBtn)
      .find((b) => b.text() === "Tak");
    await takBtn?.trigger("click");

    expect(pushMock).toHaveBeenCalledWith({
      path: "/login",
      query: { redirect: "/current-page" },
    });

    // Cleanup mocks if needed
    userRef.value = { uid: "test-user" } as any;
  });
});

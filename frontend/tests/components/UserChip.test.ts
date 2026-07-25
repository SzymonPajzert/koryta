import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import UserChip from "../../app/components/UserChip.vue";

// A plain `{ value }` holder stands in for the reactive cache ref; the
// components under test only read it during render.
const { mockResolve, mockCache } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockCache: { value: {} as Record<string, unknown> },
}));

vi.mock("../../app/composables/users", () => ({
  useUserLookup: () => ({
    cache: mockCache,
    resolve: mockResolve,
    displayName: (uid?: string | null) => {
      if (!uid) return "Nieznany";
      const info = mockCache.value[uid] as {
        displayName?: string | null;
        email?: string | null;
      } | null;
      return info?.displayName || info?.email || uid;
    },
  }),
}));

const vuetify = createVuetify({ components, directives });

const mountChip = (uid?: string | null) =>
  mount(UserChip, {
    global: { plugins: [vuetify] },
    props: { uid },
  });

describe("UserChip", () => {
  beforeEach(() => {
    mockCache.value = {};
    mockResolve.mockClear();
  });

  it("shows 'Nieznany' when there is no uid", () => {
    const wrapper = mountChip(null);
    expect(wrapper.text()).toContain("Nieznany");
  });

  it("requests resolution for its uid", () => {
    mountChip("user-1");
    expect(mockResolve).toHaveBeenCalledWith(["user-1"]);
  });

  it("renders the resolved display name", () => {
    mockCache.value = {
      "user-1": {
        displayName: "Jan Kowalski",
        email: "jan@example.com",
        photoURL: null,
      },
    };
    const wrapper = mountChip("user-1");
    expect(wrapper.text()).toContain("Jan Kowalski");
  });

  it("falls back to the raw uid while unresolved", () => {
    const wrapper = mountChip("some-raw-uid");
    expect(wrapper.text()).toContain("some-raw-uid");
  });
});

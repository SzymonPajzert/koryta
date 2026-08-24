import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useAuthState } from "../../app/composables/auth";
import { mount } from "@vue/test-utils";
import DefaultLayout from "../../app/layouts/default.vue";
import type { MockAuthState } from "../shared/types";

import { createVuetify } from "vuetify";

// Mock dependencies
vi.mock("../../app/composables/auth");

vi.mock("vuetify", async () => {
  const actual = await vi.importActual("vuetify");
  return {
    ...actual,
    useDisplay: () => ({ mdAndUp: { value: true } }),
  };
});
const vuetify = createVuetify();

describe("DefaultLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts successfully", async () => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref({ uid: "test-admin" }),
      userConfig: { data: ref({}) },
      logout: vi.fn(),
    } as MockAuthState);

    const wrapper = mount(DefaultLayout, {
      global: {
        plugins: [vuetify],
        stubs: {
          NuxtPage: true,
          DialogMulti: true,
          OmniSearch: true,
          "v-app-bar": {
            template: "<div><slot /><slot name='append' /></div>",
          },
          "v-app-bar-title": true,
          "v-spacer": true,
          "v-btn": {
            template: "<button :to='to'><slot /></button>",
            props: ["to"],
          },
          "v-icon": true,
          "v-avatar": true,
          "v-main": { template: "<div><slot /></div>" },
          "v-toolbar": { template: "<div><slot /></div>" },
          "v-container": { template: "<div><slot /></div>" },
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });
});

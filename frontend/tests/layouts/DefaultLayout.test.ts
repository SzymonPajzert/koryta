import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { useAuthState } from "../../app/composables/auth";
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

// mockNuxtImport is hoisted above the module body, so the route has to be too.
// Each test sets the path before it mounts.
const route = vi.hoisted(() => ({
  path: "/",
  meta: {} as Record<string, unknown>,
}));
mockNuxtImport("useRoute", () => () => route);

function mountLayout(isAdmin = false) {
  vi.mocked(useAuthState).mockReturnValue({
    user: ref({ uid: "test-admin" }),
    isAdmin: ref(isAdmin),
    userConfig: { data: ref({}) },
    logout: vi.fn(),
  } as MockAuthState);

  return mount(DefaultLayout, {
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
          template: "<button :to='to' :data-active='active'><slot /></button>",
          props: ["to", "active"],
        },
        "v-icon": true,
        "v-avatar": true,
        "v-main": { template: "<div><slot /></div>" },
        "v-toolbar": { template: "<div><slot /></div>" },
        "v-container": { template: "<div><slot /></div>" },
      },
    },
  });
}

/** The toolbar is client-only, so it is there a tick after mounting. */
async function toolbarButton(
  wrapper: ReturnType<typeof mountLayout>,
  label: string,
) {
  await flushPromises();
  return wrapper.findAll("button").find((b) => b.text() === label);
}

describe("DefaultLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.path = "/";
    route.meta = {};
  });

  it("mounts successfully", async () => {
    const wrapper = mountLayout();

    expect(wrapper.exists()).toBe(true);
  });

  it("gives every signed-in reader Rewizje, Aktywność and Zespół", async () => {
    const wrapper = mountLayout();

    for (const label of ["Rewizje", "Aktywność", "Zespół"]) {
      expect(await toolbarButton(wrapper, label)).toBeDefined();
    }
    expect(await toolbarButton(wrapper, "Admin")).toBeUndefined();
  });

  it("folds the admin pages into one Admin menu", async () => {
    const wrapper = mountLayout(true);

    expect(await toolbarButton(wrapper, "Admin")).toBeDefined();
    // The buttons it replaced are not in the strip any more.
    for (const label of ["Kolejka", "Notatki", "Zgłoszenia"]) {
      expect(await toolbarButton(wrapper, label)).toBeUndefined();
    }
  });

  // What makes a page the admin's is its middleware, as it is for the router:
  // /admin/rewizje sits under /admin but takes any signed-in reader.
  it.each([
    ["/admin/notatki", "admin"],
    ["/admin/rewizje/kolejka/", "admin"],
    ["/admin/opinie", ["auth", "admin"]],
  ])("lights the Admin menu on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const admin = await toolbarButton(wrapper, "Admin");
    expect(admin?.attributes("data-active")).toBe("true");
    expect(admin?.attributes("aria-current")).toBe("true");
  });

  it.each([
    ["/admin/rewizje", "auth"],
    ["/admin/rewizje/abc123", "auth"],
    ["/", undefined],
  ])("leaves the Admin menu dark on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const admin = await toolbarButton(wrapper, "Admin");
    expect(admin?.attributes("data-active")).toBe("false");
    expect(admin?.attributes("aria-current")).toBeUndefined();
  });
});

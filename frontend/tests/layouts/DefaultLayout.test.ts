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
        // Open, in place: the real menu draws its list only once clicked,
        // and then outside the toolbar.
        "v-menu": {
          template:
            "<div data-menu><slot name='activator' :props='{}' /><div data-menu-list><slot /></div></div>",
        },
        "v-list": { template: "<div><slot /></div>" },
        "v-list-item": {
          template:
            "<a :data-to='typeof to === \"string\" ? to : JSON.stringify(to)' :href='href'>{{ title }}</a>",
          props: ["to", "href", "title"],
        },
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

/** The entries of the menu under `label`, in order. */
async function menuEntries(
  wrapper: ReturnType<typeof mountLayout>,
  label: string,
) {
  await flushPromises();
  const menu = wrapper
    .findAll("[data-menu]")
    .find((node) => node.find("button").text() === label);
  return (menu?.findAll("[data-menu-list] a") ?? []).map((entry) => ({
    title: entry.text(),
    to: entry.attributes("data-to"),
  }));
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

  it("puts QA and its problems in the Zespół menu, for everybody", async () => {
    const wrapper = mountLayout();

    const titles = (await menuEntries(wrapper, "Zespół")).map((e) => e.title);
    expect(titles).toEqual([
      "QA - zmiany do sprawdzenia",
      "Problemy z QA",
      "Nowy bug w GitHubie",
    ]);
  });

  it("links the menu's problems to the tab that shows them", async () => {
    const wrapper = mountLayout();

    const problems = (await menuEntries(wrapper, "Zespół")).find(
      (entry) => entry.title === "Problemy z QA",
    );
    expect(JSON.parse(problems!.to!)).toEqual({
      path: "/qa",
      query: { widok: "problemy" },
    });
  });

  // One place for what is wrong: the reports sit beside the QA problems they
  // include, not in a second menu.
  it("gives an admin the reports beside them, and not under Admin", async () => {
    const wrapper = mountLayout(true);

    expect(await menuEntries(wrapper, "Zespół")).toEqual([
      { title: "QA - zmiany do sprawdzenia", to: "/qa" },
      { title: "Problemy z QA", to: expect.stringContaining("problemy") },
      { title: "Zgłoszenia", to: "/admin/opinie" },
      { title: "Nowy bug w GitHubie", to: undefined },
    ]);
    const admin = (await menuEntries(wrapper, "Admin")).map((e) => e.title);
    expect(admin).toEqual([
      "Panel administracyjny",
      "Kolejka zmian",
      "Notatki",
    ]);
  });

  // What makes a page the admin's is its middleware, as it is for the router:
  // /admin/rewizje sits under /admin but takes any signed-in reader - and that
  // holds for the review queue too, now a section of it: "Kolejka zmian" in
  // the menu lands on a page that lights "Rewizje", not this menu.
  it.each([
    ["/admin/notatki", "admin"],
    ["/admin/krawedzie/", "admin"],
    ["/admin/krawedzie", ["auth", "admin"]],
  ])("lights the Admin menu on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const admin = await toolbarButton(wrapper, "Admin");
    expect(admin?.attributes("data-active")).toBe("true");
    expect(admin?.attributes("aria-current")).toBe("true");
  });

  // /admin/opinie is an admin's page, but its entry is under "Zespół" now.
  it.each([
    ["/admin/rewizje", "auth"],
    ["/admin/rewizje/abc123", "auth"],
    ["/", undefined],
    ["/admin/opinie", "admin"],
  ])("leaves the Admin menu dark on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const admin = await toolbarButton(wrapper, "Admin");
    expect(admin?.attributes("data-active")).toBe("false");
    expect(admin?.attributes("aria-current")).toBeUndefined();
  });

  // Like "Admin", the menu has no `to` of its own to light it.
  it.each([
    ["/qa", "auth"],
    ["/qa/", "auth"],
    ["/admin/opinie", "admin"],
  ])("lights the Zespół menu on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const team = await toolbarButton(wrapper, "Zespół");
    expect(team?.attributes("data-active")).toBe("true");
    expect(team?.attributes("aria-current")).toBe("true");
  });

  it.each([
    ["/", undefined],
    ["/admin/notatki", "admin"],
    ["/qa-cos-innego", undefined],
  ])("leaves the Zespół menu dark on %s", async (path, middleware) => {
    route.path = path;
    route.meta = { middleware };
    const wrapper = mountLayout(true);

    const team = await toolbarButton(wrapper, "Zespół");
    expect(team?.attributes("data-active")).toBe("false");
    expect(team?.attributes("aria-current")).toBeUndefined();
  });
});

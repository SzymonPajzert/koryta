import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import OmniSearch from "../../app/components/OmniSearch.vue";
import { defineComponent, h, Suspense, nextTick } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { createRouter, createMemoryHistory } from "vue-router";

const vuetify = createVuetify({
  components,
  directives,
});

// Mock useAsyncData for graph (default empty)
vi.stubGlobal("useAsyncData", () => ({
  data: {
    value: {
      nodeGroups: [],
      nodes: {},
    },
  },
}));

vi.stubGlobal("$fetch", vi.fn());

// Mock useAuthState
vi.stubGlobal("useAuthState", () => ({
  idToken: { value: "test-token" },
  authFetch: () => ({
    data: {
      value: {
        nodeGroups: [
          { id: "group1", name: "Group 1", stats: { people: 10 } },
          { id: "group2", name: "Group 2", stats: { people: 5 } },
        ],
        nodes: {
          person1: { type: "circle", name: "Person 1" },
          place1: { type: "rect", name: "Place 1" },
        },
      },
    },
    refresh: vi.fn(),
  }),
}));

describe("OmniSearch", () => {
  // Setup Router
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div>Home</div>" } },
      {
        path: "/entity/place/:id",
        component: { template: "<div>Place</div>" },
      },
    ],
  });

  it("renders correctly and has items", async () => {
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify, router],
        },
      },
    );

    await flushPromises();
    expect(wrapper.find("input").exists()).toBe(true);

    // We can also trigger search
    const input = wrapper.find("input");
    await input.setValue("Person");
  });

  it("keeps a hit whose middle name sits between the words typed", async () => {
    // Vuetify filters the menu again on the client, and its own filter wants
    // the query to appear in the title as one substring - which threw away the
    // result the server had just been taught to find. Two of every five people
    // in the database carry a middle name, so this was the whole bug on its
    // own. Read off the prop rather than the rendered menu: the menu lives in
    // a teleport that only exists once the field is focused, and what is worth
    // pinning here is which filter the field was handed.
    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      { global: { plugins: [vuetify, router] } },
    );

    await flushPromises();

    const filter = wrapper
      .findComponent({ name: "VAutocomplete" })
      .props("customFilter") as (value: string, query: string) => boolean;

    expect(filter("Andrzej Józef Namysło", "Andrzej Namysło")).toBe(true);
    expect(filter("Andrzej Józef Namysło", "Andrzej N")).toBe(true);
    // Still narrows the party rows, which never go near the server.
    expect(filter("PO", "PO")).toBe(true);
    expect(filter("PiS", "PO")).toBe(false);
    expect(filter("Anna Nowak", "Andrzej Namysło")).toBe(false);

    wrapper.unmount();
  });

  it.skip("redirects to place for 'rect' nodes", async () => {
    // Spy on router push
    const pushSpy = vi.spyOn(router, "push");
    // Clear calls from previous tests/mounts
    pushSpy.mockClear();

    const wrapper = mount(
      defineComponent({
        render() {
          return h(Suspense, null, {
            default: () => h(OmniSearch),
            fallback: () => h("div", "fallback"),
          });
        },
      }),
      {
        global: {
          plugins: [vuetify, router],
        },
      },
    );

    await flushPromises();

    // Simulate item selection which OmniSearch handles via watcher on model
    const autocomplete = wrapper.findComponent({ name: "VAutocomplete" });
    expect(autocomplete.exists()).toBe(true);

    await autocomplete.emit("update:modelValue", {
      title: "Place 1",
      path: "/entity/place/place1",
      analyticsKind: "place",
    });

    await nextTick();
    await nextTick();

    // Check call
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/entity/place/place1",
      }),
    );
  });
});

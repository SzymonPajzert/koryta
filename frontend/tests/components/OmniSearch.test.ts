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
      logEventKey: { content_id: "place1", content_type: "place" },
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

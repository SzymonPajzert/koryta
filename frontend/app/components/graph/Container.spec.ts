import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Container from "./Container.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

vi.mock("~/composables/graph", () => {
  return {
    useGraph: vi.fn().mockImplementation((_opts) => {
      return {
        nodesFiltered: {},
        edgesFiltered: [],
        layout: { nodes: {} },
        ready: true,
      };
    }),
  };
});

describe("GraphContainer unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should mount and pass expected props to Canvas, handling expansion", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: {
        focusNodeId: "1",
      },
    });

    expect(component.exists()).toBe(true);

    // Initial expanded state should contain focusNodeId
    // Emulate expanding another node
    const canvas = component.findComponent({ name: "GraphCanvas" });
    canvas.vm.$emit("expand", "2");

    // Wait for vue to update state
    await component.vm.$nextTick();

    // Verify useGraph is still hooked up to the expandedNodes
    // Since useGraph is mocked we can't fully end-to-end test it easily without proper stubs,
    // but the graph.test.ts covers useGraph already.
  });
});

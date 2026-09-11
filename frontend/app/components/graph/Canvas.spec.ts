import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { GraphCanvas } from "#components";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ForceLayout } from "v-network-graph/lib/force-layout";
import type { Node as GraphNode } from "~~/shared/graph/model";

const vuetify = createVuetify({ components, directives });

const twoPeople: Record<string, GraphNode> = {
  p1: { name: "Anna Nowak", type: "circle", color: "#000" },
  p2: { name: "Krzysztof Wójcik", type: "circle", color: "#000" },
};

describe("GraphCanvas", () => {
  it("can mount some component", async () => {
    const component = await mountSuspended(GraphCanvas, {
      global: { plugins: [vuetify] },
    });
    expect(component.text()).toMatchInlineSnapshot(`"Ładuję..."`);
  });

  it("installs a force layout for a graph it is handed on first render", async () => {
    // The regression this pins. Both watchers here used to wait for a change,
    // so a page whose data was already in hand when it first rendered - a
    // reload, where the server sends the graph with the markup - tripped
    // neither: the nodes arrive with the first render, and the focus node is
    // pinned by a `key` so it never moves. Nothing installed a layout handler,
    // v-network-graph fell back to its default, and every node was drawn at the
    // same spot. It read as the simulation pulling nodes together; it was the
    // simulation never being asked to run.
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: twoPeople,
        edges: [{ source: "p1", target: "p2", type: "connection" }],
        ready: true,
        focusNodeId: "p1",
      },
      global: { plugins: [vuetify] },
    });

    const configs = (
      component.vm as unknown as {
        configs: { view: { layoutHandler?: unknown } };
      }
    ).configs;

    expect(configs.view.layoutHandler).toBeInstanceOf(ForceLayout);
  });
  it("draws a glyph inside every node, and a ring around the subject", async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: {
          p1: {
            name: "Anna Nowak",
            type: "circle",
            color: "#073b76",
            entityType: "person",
            depth: 0,
          },
          c1: {
            name: "Orlen",
            type: "rect",
            color: "#6b7a83",
            entityType: "place",
            depth: 1,
          },
        } as unknown as Record<string, GraphNode>,
        edges: [{ source: "p1", target: "c1", type: "employed" }],
        ready: true,
        focusNodeId: "p1",
      },
      global: { plugins: [vuetify] },
    });

    // One material path per node, and two different ones: a coloured disc says
    // "somebody" and a grey box says "something", which is all a reader had to
    // go on before.
    const glyphs = component.findAll(".v-ng-node path");
    expect(glyphs).toHaveLength(2);
    expect(glyphs[0]!.attributes("d")).not.toBe(glyphs[1]!.attributes("d"));

    // White ink on the navy, which is what the luminance pick is for.
    expect(glyphs[0]!.attributes("fill")).toBe("#ffffff");

    // The company is a rectangle; the person is a circle, plus a second one for
    // the ring that marks whose page this is.
    expect(component.findAll(".v-ng-node rect")).toHaveLength(1);
    expect(component.findAll(".v-ng-node circle")).toHaveLength(2);
  });

  it("draws the far ring smaller than the near one", async () => {
    const component = await mountSuspended(GraphCanvas, {
      global: { plugins: [vuetify] },
    });
    const normal = (
      component.vm as unknown as {
        configs: {
          node: { normal: { radius: (node: object) => number } };
        };
      }
    ).configs.node.normal;

    // Flat, a two hop graph is forty equal dots with no way to tell whose page
    // it is.
    expect(normal.radius({ depth: 0 })).toBeGreaterThan(
      normal.radius({ depth: 1 }),
    );
    expect(normal.radius({ depth: 1 })).toBeGreaterThan(
      normal.radius({ depth: 2 }),
    );
  });

  it("breaks a long name over several lines, on a plate of its own", async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: {
          c1: {
            name: "Wojewódzki Fundusz Ochrony Środowiska w Krakowie",
            type: "rect",
            color: "#888",
          },
        },
        edges: [],
        ready: true,
      },
      global: { plugins: [vuetify] },
    });

    // v-network-graph draws one `tspan` per line, so the lines are the proof
    // that the name was broken rather than left to run across the canvas.
    const lines = component.findAll(".v-ng-node-label tspan");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text()).join(" ")).toBe(
      "Wojewódzki Fundusz Ochrony Środowiska w Krakowie",
    );

    // And the plate behind it, which is what makes a label crossing an edge or
    // another label readable.
    expect(
      component.find(".v-ng-node-label .v-ng-text-background").exists(),
    ).toBe(true);
  });
  // The regression this pins. v-network-graph builds its layer list in a
  // computed whose only test is `"edge-label" in $slots`, and that computed
  // does not track the slots object - so declaring the slot behind
  // `v-if="edgeLabels"` dropped the layer at first mount and no later toggle
  // could bring it back. The feature shipped and had never drawn anything.
  it("mounts the edge-label layer even with the labels switched off", async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: twoPeople,
        edges: [{ source: "p1", target: "p2", type: "connection" }],
        ready: true,
        focusNodeId: "p1",
        edgeLabels: false,
      },
      global: { plugins: [vuetify] },
    });

    expect(component.find(".v-ng-layer-edge-labels").exists()).toBe(true);
    // Off still draws no text: the guard moved inside the slot.
    expect(component.text()).not.toContain("Powiązanie");
  });

  it("draws the label text once the reader switches the labels on", async () => {
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: twoPeople,
        edges: [
          { source: "p1", target: "p2", type: "connection", label: "Znajomi" },
        ],
        ready: true,
        focusNodeId: "p1",
        edgeLabels: false,
      },
      global: { plugins: [vuetify] },
    });

    await component.setProps({ edgeLabels: true });
    await component.vm.$nextTick();

    expect(component.find(".v-ng-layer-edge-labels").text()).toContain(
      "Znajomi",
    );
  });
});

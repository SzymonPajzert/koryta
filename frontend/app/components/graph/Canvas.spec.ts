import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { GraphCanvas } from "#components";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ForceLayout } from "v-network-graph/lib/force-layout";
import type { Node as GraphNode } from "~~/shared/graph/model";

const vuetify = createVuetify({ components, directives });

/** The per-edge style callbacks Canvas.vue installs, as they are stored on the
 * resolved config. v-network-graph calls each of these with the edge it is
 * about to draw. */
type EdgeStroke = {
  width: (edge: { type: string }) => number;
  color: (edge: { type: string }) => string;
  dasharray: (edge: { type: string }) => string | number;
};

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

  it("draws a derived co-candidate edge dashed, and a recorded one solid", async () => {
    // The honesty requirement, checked through v-network-graph's own config
    // resolution rather than by reading the callbacks back: a line worked out
    // from two candidacies naming the same list must not look like the lines a
    // reader can click through to a source.
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: twoPeople,
        edges: [
          { source: "p1", target: "p2", type: "co_candidate" },
          { source: "p2", target: "p1", type: "connection" },
        ],
        ready: true,
        focusNodeId: "p1",
      },
      global: { plugins: [vuetify] },
    });

    const { normal } = (
      component.vm as unknown as {
        configs: { edge: { normal: EdgeStroke } };
      }
    ).configs.edge;

    const derived = { source: "p1", target: "p2", type: "co_candidate" };
    const recorded = { source: "p2", target: "p1", type: "connection" };

    expect(normal.dasharray(derived)).toBe("4 3");
    expect(normal.dasharray(recorded)).toBe(0);
    expect(normal.width(derived)).toBeLessThan(normal.width(recorded));
    expect(normal.color(derived)).not.toBe(normal.color(recorded));
  });
});

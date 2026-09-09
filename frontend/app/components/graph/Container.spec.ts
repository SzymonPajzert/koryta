import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref, computed } from "vue";
import Container from "./Container.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

/** What the real composable hands back, minus the fetch. `maxDepth` is captured
 * so the depth control can be checked against the url the container would ask
 * for. */
const asked: { maxDepth?: unknown }[] = [];

/** What the canvas is holding, for the tests that care what the legend makes of
 * it. Reset per test by `beforeEach`. */
let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, unknown>[] = [];

vi.mock("~/composables/graph", () => {
  return {
    useGraph: vi.fn().mockImplementation((opts: { maxDepth?: unknown }) => {
      asked.push(opts);
      return {
        nodesFiltered: computed(() => nodes),
        edgesFiltered: computed(() => edges),
        ready: ref(true),
        omitted: computed(() => 0),
      };
    }),
  };
});

describe("GraphContainer unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asked.length = 0;
    nodes = { "2": { name: "Orlen", type: "rect", color: "#6b7a83" } };
    edges = [];
  });

  it("names what the reader picked, and offers its page", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.exists()).toBe(true);
    // Nothing picked yet: the footer says how to use the canvas rather than
    // sitting empty.
    expect(component.text()).toContain("Najedź na węzeł");

    const canvas = component.findComponent({ name: "GraphCanvas" });
    canvas.vm.$emit("select", "2");
    await component.vm.$nextTick();

    expect(component.text()).toContain("Orlen");
    expect(component.text()).toContain("Otwórz stronę");
  });

  it("asks for the reach the page wanted", async () => {
    await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1", maxDepth: 2 },
    });

    // A ref rather than a number: the bar above the canvas lets the reader
    // change it, and the url has to follow.
    expect(asked[0]?.maxDepth).toMatchObject({ value: 2 });
  });

  it("explains what the nodes are", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.text()).toContain("Osoba");
    expect(component.text()).toContain("Instytucja");
    expect(component.text()).toContain("Region");
  });

  it("names the party colours the canvas is actually using", async () => {
    nodes = {
      "2": { name: "Jan Kowalski", type: "circle", parties: ["PiS"] },
      "3": { name: "Anna Nowak", type: "circle", parties: ["Nowa Lewica"] },
      // Same red as Nowa Lewica - the same party renamed - so the legend has
      // to say so on one line rather than draw the swatch twice.
      "4": { name: "Piotr Wójcik", type: "circle", parties: ["SLD"] },
      // No colour of its own, so it is drawn as a person with no party and
      // must not get a line here.
      "5": { name: "Ewa Lis", type: "circle", parties: ["Razem"] },
    };

    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    const legend = component.get('[data-testid="graph-legend"]');
    expect(legend.text()).toContain("PiS");
    expect(legend.text()).toContain("Nowa Lewica / SLD");
    expect(legend.text()).not.toContain("Razem");
    // PO is nobody's here, and a legend listing all eight parties would be
    // longer than the graph it explains.
    expect(legend.text()).not.toContain("PO");
    // The plain blue stops being "a person" once a colour means something.
    expect(legend.text()).toContain("Osoba: inne / brak partii");

    const swatches = legend.findAll("circle").map((c) => c.attributes("fill"));
    expect(swatches).toContain("#073b76");
    expect(swatches).toContain("#D40E20");
  });

  it("stands the legend in the bar with nothing to fold it away", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.find('[data-testid="graph-legend"]').exists()).toBe(true);
    // The fold button defaulted to open and reset to open on every fresh
    // document, so it never bought back the room it promised.
    expect(component.find('[data-testid="graph-legend-toggle"]').exists()).toBe(
      false,
    );
  });

  it("names the line styles the canvas is actually drawing", async () => {
    edges = [
      { source: "1", target: "2", type: "employed" },
      // Drawn the same grey dash, so they are one entry and not three - the
      // legend would otherwise claim a distinction the canvas is not making.
      { source: "3", target: "1", type: "mentions" },
      { source: "4", target: "1", type: "comment" },
    ];

    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    const legend = component.get('[data-testid="graph-edge-legend"]');
    expect(legend.text()).toContain("Zatrudnienie");
    expect(legend.text()).toContain("Wzmianka w artykule lub notatce");
    // Nothing on this canvas is a seat or a candidacy, and a legend listing
    // every relation the site knows would be longer than the graph.
    expect(legend.text()).not.toContain("Siedziba");
    expect(legend.text()).not.toContain("Kandydatura");

    const lines = legend.findAll("line");
    expect(lines).toHaveLength(2);
    // The question the reader asked: employment is the one solid line, and
    // everything else is dashed.
    expect(lines[0]?.attributes("stroke-dasharray")).toBeUndefined();
    expect(lines[1]?.attributes("stroke-dasharray")).toBe("2 4");
  });

  it("says nothing about lines when the canvas draws none", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.find('[data-testid="graph-edge-legend"]').exists()).toBe(
      false,
    );
  });

  it("asks the canvas for edge labels only once the reader does", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    const canvas = component.findComponent({ name: "GraphCanvas" });
    const toggle = component.get('[data-testid="graph-edge-labels-toggle"]');

    // Off to begin with: at two hops there are more labels than there is room.
    expect(canvas.props("edgeLabels")).toBe(false);
    expect(toggle.text()).toContain("Opisy powiązań");

    await toggle.trigger("click");
    expect(canvas.props("edgeLabels")).toBe(true);
    expect(toggle.text()).toContain("Ukryj opisy");
  });
});

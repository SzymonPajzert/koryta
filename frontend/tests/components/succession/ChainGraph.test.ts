import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ChainGraph from "../../../app/components/succession/ChainGraph.vue";
import type {
  ChainCandidateView,
  ChainDirection,
  ChainNode,
} from "../../../app/composables/successionChain";
import type {
  SuccessionCandidate,
  SuccessionChainStep,
  SuccessionVia,
} from "../../../server/api/edges/succession-chain.get";

/* Prop-driven, with no endpoint and no composable: the graph holds no state,
 * for the same reason the columns beside it hold none - both are a drawing of
 * one array, and the array is the chain's.
 *
 * What is asserted here is markup only. Where the circles END UP is asserted in
 * `tests/utils/successionGraphLayout.test.ts`, on coordinates, because that is
 * the only form in which a layout can be checked - a component test can say a
 * circle exists and nothing about whether it was drawn on top of another one.
 */

const ZMP = {
  companyId: "zmp",
  companyName: "Związek Miast Polskich",
  role: "Zarząd",
};

function via(extra: Partial<SuccessionVia> = {}): SuccessionVia {
  return {
    ...ZMP,
    focusEdgeId: "eFocusZmp",
    focusStart: "2003-06-04",
    focusEnd: "2015-06-01",
    edgeId: "eVia",
    start: "2001-12-06",
    end: "2003-06-04",
    gapDays: 0,
    batchSize: 1,
    ...extra,
  };
}

/** Letters only, so the id has no hyphen in it: `parseEntityUrlSlug` reads an
 * id as the last dash segment of a slug, and a fixture that breaks the rule is
 * one somebody copies into a routed test. */
function idOf(name: string): string {
  return `p${name.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, "")}`;
}

function candidate(
  name: string,
  extra: Partial<SuccessionCandidate> = {},
): SuccessionCandidate {
  return {
    personId: idOf(name),
    personName: name,
    parties: [],
    published: true,
    via: [via()],
    closestGapDays: 0,
    ...extra,
  };
}

function step(extra: Partial<SuccessionChainStep> = {}): SuccessionChainStep {
  return {
    personId: "pRyszardGrobelny",
    personName: "Ryszard Grobelny",
    parties: [],
    published: true,
    posts: [],
    predecessors: [],
    successors: [],
    hidden: 0,
    ...extra,
  };
}

function node(extra: Partial<ChainNode> = {}): ChainNode {
  return {
    key: "root",
    personId: "pRyszardGrobelny",
    personName: "Ryszard Grobelny",
    parentKey: null,
    direction: null,
    depth: 0,
    status: "ready",
    step: step(),
    predecessors: [],
    successors: [],
    ...extra,
  };
}

function childKey(
  parentKey: string,
  direction: ChainDirection,
  personId: string,
): string {
  return `${parentKey}>${direction === "predecessor" ? "p" : "s"}:${personId}`;
}

/** Open `names` under `parent`, wiring both halves the composable would have
 * written: the child nodes, and the `expandedKey` on the parent's own candidate
 * list that the arrow's provenance is joined off. */
function open(
  parent: ChainNode,
  direction: ChainDirection,
  names: string[],
  vias: SuccessionVia[] = [via()],
): ChainNode[] {
  const views: ChainCandidateView[] = names.map((name) => ({
    candidate: candidate(name, { via: vias }),
    expandedKey: childKey(parent.key, direction, idOf(name)),
    expandable: true,
  }));
  if (direction === "predecessor") parent.predecessors.push(...views);
  else parent.successors.push(...views);

  return views.map((entry, index) =>
    node({
      key: entry.expandedKey!,
      personId: entry.candidate.personId,
      personName: names[index]!,
      parentKey: parent.key,
      direction,
      depth: parent.depth + 1,
      step: step({ personName: names[index]! }),
    }),
  );
}

/** Three hops back and one forward - the chain shape this page exists for. */
function deep(): ChainNode[] {
  const focus = node();
  const [rozpara] = open(focus, "predecessor", ["Tadeusz Rozpara"]);
  const [pluta] = open(
    focus,
    "successor",
    ["Marcin Pluta"],
    [via({ gapDays: 23 })],
  );
  const [barzowski] = open(rozpara!, "predecessor", ["Jerzy Barzowski"]);
  const [jedlinski] = open(barzowski!, "predecessor", ["Jerzy Jedliński"]);
  return [focus, rozpara!, barzowski!, jedlinski!, pluta!];
}

async function render(nodes: ChainNode[]) {
  return await mountSuspended(ChainGraph, {
    props: { nodes, focusKey: "root" },
  });
}

function parts(wrapper: Awaited<ReturnType<typeof render>>, testid: string) {
  return wrapper.findAll(`[data-testid="${testid}"]`);
}

describe("SuccessionChainGraph", () => {
  it("solves the geometry once when only a name or a status changes", async () => {
    // The chain's `nodes` array is rebuilt when a person is inserted AND again
    // when their answer lands, but only the first of those can move a circle.
    // Re-solving on the second cost a second 800-tick run per expansion, which
    // could only ever reproduce the first - so the geometry is cached on the
    // shape of the chain and the names are folded back in afterwards.
    const focus = node({ personName: "Ryszard Grobelny" });
    const pending = node({
      key: childKey("root", "predecessor", "pTadeuszRozpara"),
      personId: "pTadeuszRozpara",
      personName: "",
      parentKey: "root",
      direction: "predecessor",
      depth: 1,
      status: "pending",
      step: null,
    });

    const wrapper = await mountSuspended(ChainGraph, {
      props: { nodes: [focus, pending], focusKey: "root" },
    });

    const circles = () =>
      parts(wrapper, "chain-graph-node").map((c) => ({
        cx: c.attributes("transform") ?? c.attributes("cx"),
      }));
    const before = circles();
    expect(wrapper.text()).toContain("wczytujemy…");

    // The same person, same place in the chain, now named - a new array, as
    // the composable really does hand over.
    await wrapper.setProps({
      nodes: [
        focus,
        { ...pending, personName: "Tadeusz Rozpara", status: "ready" as const },
      ],
      focusKey: "root",
    });

    expect(wrapper.text()).toContain("Tadeusz Rozpara");
    expect(wrapper.text()).not.toContain("wczytujemy…");
    // Same coordinates, because nothing about the shape changed.
    expect(circles()).toEqual(before);
  });
  it("draws one circle per open person and one arrow per hop", async () => {
    const wrapper = await render(deep());
    expect(parts(wrapper, "chain-graph")).toHaveLength(1);
    expect(parts(wrapper, "chain-graph-node")).toHaveLength(5);
    // The open chain is a tree, so five people are four hops.
    expect(parts(wrapper, "chain-graph-edge")).toHaveLength(4);
    expect(
      parts(wrapper, "chain-graph-node").map((el) =>
        el.attributes("data-person"),
      ),
    ).toEqual([
      "pRyszardGrobelny",
      idOf("Tadeusz Rozpara"),
      idOf("Jerzy Barzowski"),
      idOf("Jerzy Jedliński"),
      idOf("Marcin Pluta"),
    ]);
    for (const name of [
      "Ryszard Grobelny",
      "Tadeusz Rozpara",
      "Jerzy Barzowski",
      "Jerzy Jedliński",
      "Marcin Pluta",
    ]) {
      expect(wrapper.text()).toContain(name);
    }
  });

  it("shows only what has been explored, and grows from the same array", async () => {
    // The whole contract with the columns: a person appears here because
    // somebody opened them there, and never because the graph asked for them.
    const wrapper = await render([node()]);
    expect(parts(wrapper, "chain-graph-node")).toHaveLength(1);

    await wrapper.setProps({ nodes: deep() });
    expect(parts(wrapper, "chain-graph-node")).toHaveLength(5);
    expect(parts(wrapper, "chain-graph-edge")).toHaveLength(4);
  });

  it("marks the person the page is about, once", async () => {
    const wrapper = await render(deep());
    const focus = parts(wrapper, "chain-graph-focus");
    expect(focus).toHaveLength(1);
    expect(
      focus[0]!.element
        .closest("[data-testid='chain-graph-node']")!
        .getAttribute("data-person"),
    ).toBe("pRyszardGrobelny");
  });

  it("points each arrow the way the seat moved", async () => {
    const wrapper = await render(deep());
    const rozpara = childKey("root", "predecessor", idOf("Tadeusz Rozpara"));
    const pluta = childKey("root", "successor", idOf("Marcin Pluta"));
    const hops = parts(wrapper, "chain-graph-edge").map((el) => [
      el.attributes("data-from"),
      el.attributes("data-to"),
    ]);
    // Into the focus person from whoever held the seat before them, out of
    // them into whoever held it next.
    expect(hops).toContainEqual([rozpara, "root"]);
    expect(hops).toContainEqual(["root", pluta]);
    // And the head is on the successor's end of the line.
    expect(
      parts(wrapper, "chain-graph-edge").every((el) =>
        el.attributes("marker-end")?.startsWith("url(#"),
      ),
    ).toBe(true);
  });

  it("draws an arrow pointing left where a branch doubles back", async () => {
    // Opening a predecessor's SUCCESSOR puts that person one column further
    // left, because the column side is the branch's first hop - while time
    // still runs forwards. The arrowhead is on the left-hand end, which is why
    // the direction may never be read off the x order.
    const focus = node();
    const [rozpara] = open(focus, "predecessor", ["Tadeusz Rozpara"]);
    const [kaczmarek] = open(rozpara!, "successor", [
      "Wojciech Szczęsny Kaczmarek",
    ]);
    const wrapper = await render([focus, rozpara!, kaczmarek!]);

    const arrow = parts(wrapper, "chain-graph-edge").find(
      (el) => el.attributes("data-to") === kaczmarek!.key,
    )!;
    expect(arrow.attributes("data-from")).toBe(rozpara!.key);
    expect(Number(arrow.attributes("x2"))).toBeLessThan(
      Number(arrow.attributes("x1")),
    );
  });

  it("tells a person on their way from one who may not be named", async () => {
    const focus = node();
    const [pending, unnamable, failed] = open(focus, "successor", [
      "Marcin Pluta",
      "Tadeusz Rozpara",
      "Jerzy Barzowski",
    ]);
    const wrapper = await render([
      focus,
      { ...pending!, personName: "", status: "pending", step: null },
      { ...unnamable!, personName: "", status: "ready" },
      { ...failed!, personName: "", status: "error", step: null },
    ]);

    const state = (key: string) =>
      wrapper.find(`[data-testid="chain-graph-node"][data-key="${key}"]`);

    // Three different facts behind one empty name, and three different glyphs -
    // the columns spend a spinner, an em dash and an error card on the same
    // three, and conflating any two of them is a page saying something it does
    // not know.
    expect(state(pending!.key).attributes("data-state")).toBe("pending");
    expect(state(pending!.key).text()).toContain("wczytujemy");
    expect(state(unnamable!.key).attributes("data-state")).toBe("unknown");
    expect(state(unnamable!.key).text()).toContain("—");
    expect(state(failed!.key).attributes("data-state")).toBe("error");
    expect(state(failed!.key).text()).toContain("nie wczytano");
  });

  it("says what to do when there is nothing to draw yet", async () => {
    // The state the page opens in every time: one person and no expansions.
    const wrapper = await render([node()]);
    expect(parts(wrapper, "chain-graph-edge")).toHaveLength(0);
    expect(parts(wrapper, "chain-graph-empty")[0]!.text()).toContain(
      "Rozwiń kogoś w kolumnach poniżej",
    );
    expect(parts(wrapper, "chain-graph-batch-note")).toHaveLength(0);
  });

  it("draws a batched hop weaker, and says why once", async () => {
    // Ryszard Grobelny's Związek Miast Polskich board: six seats changed on one
    // day, so the register does not say who replaced whom. Six confident
    // arrows would be the picture claiming five things nobody filed.
    const focus = node();
    const board = open(
      focus,
      "predecessor",
      [
        "Andrzej Zabiegliński",
        "Jerzy Barzowski",
        "Jerzy Jedliński",
        "Piotr Czesław Uszok",
        "Tadeusz Rozpara",
        "Wojciech Szczęsny Kaczmarek",
      ],
      [via({ batchSize: 6 })],
    );
    const wrapper = await render([focus, ...board]);

    const arrows = parts(wrapper, "chain-graph-edge");
    expect(arrows).toHaveLength(6);
    expect(arrows.every((el) => el.attributes("data-batched") === "true")).toBe(
      true,
    );
    expect(arrows.every((el) => el.classes("graph__edge--batch"))).toBe(true);

    // Once for the picture, not once per arrow: every candidate in a batch
    // carries the same `batchSize`, and the sentence is about the decision, not
    // about any one of the six.
    const note = parts(wrapper, "chain-graph-batch-note");
    expect(note).toHaveLength(1);
    expect(note[0]!.text()).toContain(
      "rejestr nie zapisuje, kto dokładnie kogo zastąpił",
    );
  });

  it("cites the register on the arrow itself", async () => {
    const wrapper = await render(deep());
    const arrow = parts(wrapper, "chain-graph-edge").find(
      (el) =>
        el.attributes("data-to") ===
        childKey("root", "successor", idOf("Marcin Pluta")),
    )!;
    // `gapLabel` from the shared module, so the arrow and the card under it
    // say the same thing about the same two filings.
    expect(arrow.find("title").text()).toBe(
      "Ryszard Grobelny → Marcin Pluta · Związek Miast Polskich · Zarząd · po 23 dniach przerwy",
    );
  });

  it("keeps the whole name reachable when the label will not hold it", async () => {
    const focus = node();
    const [long] = open(focus, "predecessor", [
      "Wojciech Szczęsny Kaczmarek Nadzwyczajny",
    ]);
    const wrapper = await render([focus, long!]);
    const drawn = wrapper.find(
      `[data-testid="chain-graph-node"][data-key="${long!.key}"]`,
    );
    expect(drawn.find("text").text()).toBe("Wojciech Szczęsny K…");
    expect(drawn.find("title").text()).toBe(
      "Wojciech Szczęsny Kaczmarek Nadzwyczajny",
    );
  });

  it("scales into whatever box it is given rather than widening the page", async () => {
    // `tests/visual/phoneWidth.ts` fails the 375px project as soon as the
    // document scrolls sideways, and it runs a day later in CI rather than in
    // quick-check. The svg is capped at its own natural width and at 100% of
    // its box, so it can only ever get smaller than the column it sits in.
    const wrapper = await render(deep());
    const svg = wrapper.find("svg");
    expect(svg.attributes("viewBox")).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(svg.attributes("style")).toContain("max-width");
    expect(svg.attributes("role")).toBe("img");
    expect(svg.attributes("aria-label")).toContain("Ryszard Grobelny");
  });

  it("hands a clicked circle back to the page, and does nothing else with it", async () => {
    const wrapper = await render(deep());
    const rozpara = childKey("root", "predecessor", idOf("Tadeusz Rozpara"));
    await wrapper
      .find(`[data-testid="chain-graph-node"][data-key="${rozpara}"]`)
      .trigger("click");
    expect(wrapper.emitted("select")).toEqual([[rozpara]]);
    // No state of its own: the picture is unchanged until the chain changes.
    expect(parts(wrapper, "chain-graph-node")).toHaveLength(5);
  });
});

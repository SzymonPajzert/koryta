import { describe, it, expect, vi } from "vitest";
import { layoutSuccessionGraph } from "~/utils/successionGraphLayout";
import type {
  ChainCandidateView,
  ChainDirection,
  ChainNode,
} from "~/composables/successionChain";
import type {
  SuccessionCandidate,
  SuccessionChainStep,
  SuccessionVia,
} from "~~/server/api/edges/succession-chain.get";

/* Coordinates, not markup. The layout is a pure function of the chain's own
 * `nodes` array precisely so that the thing worth asserting - where two
 * circles ended up relative to each other - can be asserted directly.
 * `tests/shared/graph/simulationLayout.test.ts` is the precedent and the
 * warning: its sibling mocks d3 out, so it can say a collision force was
 * configured and nothing about whether two people were drawn on top of each
 * other, which is exactly what happened.
 *
 * The fixture helpers are the ones in
 * `tests/components/succession/ChainColumns.test.ts`, kept in the same shape so
 * that a case can be moved between the two files: the columns and the graph are
 * two drawings of one array, and every disagreement between them is a bug in
 * one of them.
 */

const ZMP = {
  companyId: "zmp",
  companyName: "Związek Miast Polskich",
  role: "Zarząd",
};

const MTP = {
  companyId: "mtp",
  companyName: "Międzynarodowe Targi Poznańskie",
  role: "Rada Nadzorcza",
};

function via(
  company: { companyId: string; companyName: string; role: string },
  extra: Partial<SuccessionVia> = {},
): SuccessionVia {
  return {
    ...company,
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

/** An id with no hyphen in it, the way every node id in this register has to
 * be: `parseEntityUrlSlug` takes the id to be the last dash segment of a slug,
 * so `p-jan-1` would parse as `1`. */
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
    via: [via(ZMP)],
    closestGapDays: 0,
    ...extra,
  };
}

function view(
  person: SuccessionCandidate,
  extra: Partial<ChainCandidateView> = {},
): ChainCandidateView {
  return { candidate: person, expandedKey: null, expandable: true, ...extra };
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

/** The composable's own key builder (`successionChain.ts`), repeated here
 * rather than exported: a fixture that agreed with the code by importing from
 * it would pass however the code changed. */
function childKey(
  parentKey: string,
  direction: ChainDirection,
  personId: string,
): string {
  return `${parentKey}>${direction === "predecessor" ? "p" : "s"}:${personId}`;
}

/** Open `names` under `parent`, on `direction`, and hand back the nodes that
 * appear.
 *
 * Wires both halves of what the composable would have written: the child nodes,
 * and the `expandedKey` on the parent's own candidate list that the layout
 * joins the edge's provenance off. Wiring only one of them is the mistake this
 * helper exists to make impossible - the graph would still draw the arrow, and
 * silently draw it bare.
 */
function open(
  parent: ChainNode,
  direction: ChainDirection,
  names: string[],
  vias: (name: string) => SuccessionVia[] = () => [via(ZMP)],
): ChainNode[] {
  const views = names.map((name) =>
    view(candidate(name, { via: vias(name) }), {
      expandedKey: childKey(parent.key, direction, idOf(name)),
    }),
  );
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

/** A letters-only, hyphen-free suffix, so that a generated fixture of any
 * length is still a set of distinct people once `idOf` has stripped it. */
function nth(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < 26
    ? alphabet[index]!
    : `${alphabet[Math.floor(index / 26) - 1]!}${alphabet[index % 26]!}`;
}

/** Ryszard Grobelny's real Związek Miast Polskich board, all six opened: the
 * worst shape a single column has to survive short of the register's own
 * maximum. Every one of the six left the seat on the day his term began, so
 * the register filed a batch and not a handover. */
const ZMP_BOARD = [
  "Andrzej Zabiegliński",
  "Jerzy Barzowski",
  "Jerzy Jedliński",
  "Piotr Czesław Uszok",
  "Tadeusz Rozpara",
  "Wojciech Szczęsny Kaczmarek",
];

function grobelny(): ChainNode[] {
  const focus = node();
  const board = open(focus, "predecessor", ZMP_BOARD, () => [
    via(ZMP, { batchSize: 6 }),
  ]);
  return [focus, ...board];
}

/** A branch three hops back, plus a second one hop forward - the chain shape
 * the page exists for, and the one both drawings have to agree about. */
function deep(): ChainNode[] {
  const focus = node();
  const [rozpara] = open(focus, "predecessor", ["Tadeusz Rozpara"]);
  const [pluta] = open(focus, "successor", ["Marcin Pluta"], () => [
    via(MTP, { gapDays: 23 }),
  ]);
  const [barzowski] = open(rozpara!, "predecessor", ["Jerzy Barzowski"]);
  const [jedlinski] = open(barzowski!, "predecessor", ["Jerzy Jedliński"]);
  return [focus, rozpara!, barzowski!, jedlinski!, pluta!];
}

function byKey(layout: ReturnType<typeof layoutSuccessionGraph>) {
  return new Map(layout.nodes.map((entry) => [entry.key, entry]));
}

/** The closest two circles come to each other anywhere in the picture. */
function closestPair(nodes: { x: number; y: number }[]): number {
  let closest = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      closest = Math.min(
        closest,
        Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y),
      );
    }
  }
  return closest;
}

describe("layoutSuccessionGraph", () => {
  it("draws the focus person alone, with nothing to point at", () => {
    // The state the page opens in, every time: one person, no expansions, and
    // a graph that has to be a picture of that rather than of nothing.
    const layout = layoutSuccessionGraph([node()]);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(layout.nodes[0]).toMatchObject({
      key: "root",
      personId: "pRyszardGrobelny",
      name: "Ryszard Grobelny",
      column: 0,
      focus: true,
      status: "ready",
      unnamable: false,
    });
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("hands back an empty box rather than a degenerate one", () => {
    // An SVG whose width or height is zero has its rendering disabled
    // outright, which reads as a broken component rather than as an empty one.
    const layout = layoutSuccessionGraph([]);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("puts the columns in the order the columns below put them", () => {
    const layout = layoutSuccessionGraph(deep());
    // Deepest predecessor leftmost, focus in the middle, successor on the
    // right - the same left-to-right reading as ChainColumns, which is what
    // lets a reader look from one to the other.
    expect(
      [...layout.nodes].sort((a, b) => a.x - b.x).map((entry) => entry.name),
    ).toEqual([
      "Jerzy Jedliński",
      "Jerzy Barzowski",
      "Tadeusz Rozpara",
      "Ryszard Grobelny",
      "Marcin Pluta",
    ]);
    expect(
      [...layout.nodes].sort((a, b) => a.x - b.x).map((entry) => entry.column),
    ).toEqual([-3, -2, -1, 0, 1]);

    // One column per used depth and no empty slots: the graph is exactly as
    // wide as the chain somebody has opened.
    expect(new Set(layout.nodes.map((entry) => entry.x)).size).toBe(5);
    expect(layout.width).toBe(5 * 150);
  });

  it("has no column at all on a side nobody has opened", () => {
    const focus = node();
    const board = open(focus, "predecessor", ["Tadeusz Rozpara"]);
    const layout = layoutSuccessionGraph([focus, ...board]);
    expect(layout.width).toBe(2 * 150);
    expect(layout.nodes.map((entry) => entry.column).sort()).toEqual([-1, 0]);
  });

  it("points every arrow the way the seat moved", () => {
    const layout = layoutSuccessionGraph(deep());
    const rozpara = childKey("root", "predecessor", idOf("Tadeusz Rozpara"));
    const pluta = childKey("root", "successor", idOf("Marcin Pluta"));

    // A predecessor hop: the person opened on the left held the seat FIRST, so
    // the arrow runs from them into the person the page is about.
    expect(layout.edges).toContainEqual(
      expect.objectContaining({ fromKey: rozpara, toKey: "root" }),
    );
    // A successor hop, the other way round.
    expect(layout.edges).toContainEqual(
      expect.objectContaining({ fromKey: "root", toKey: pluta }),
    );
    // One arrow per hop and no more: the open chain is a tree.
    expect(layout.edges).toHaveLength(4);
  });

  it("points an arrow leftwards where a branch doubles back", () => {
    // The case with no fixture anywhere else, and the reason the direction may
    // never be read off the x order: opening a predecessor's SUCCESSOR puts
    // that person one column further left - the column side is the branch's
    // first hop - while time still runs forwards. The arrow has to point away
    // from the focus person, i.e. leftwards.
    const focus = node();
    const [rozpara] = open(focus, "predecessor", ["Tadeusz Rozpara"]);
    const [kaczmarek] = open(rozpara!, "successor", [
      "Wojciech Szczęsny Kaczmarek",
    ]);
    const layout = layoutSuccessionGraph([focus, rozpara!, kaczmarek!]);
    const nodes = byKey(layout);

    expect(nodes.get(kaczmarek!.key)!.column).toBe(-2);
    const edge = layout.edges.find((entry) => entry.toKey === kaczmarek!.key)!;
    expect(edge.fromKey).toBe(rozpara!.key);
    expect(nodes.get(edge.toKey)!.x).toBeLessThan(nodes.get(edge.fromKey)!.x);
  });

  it("settles on the same coordinates every time", () => {
    // The whole reason the simulation is stepped synchronously and thrown away.
    // d3 seeds positions from a phyllotaxis spiral and jiggles from its own
    // LCG, never from Math.random, so a given array has one answer - and a
    // graph that moved between two renders of the same chain would read as the
    // page reloading itself.
    const first = layoutSuccessionGraph(grobelny());
    const second = layoutSuccessionGraph(grobelny());
    expect(second).toEqual(first);
    // And again from an array the caller already used, which is what a Vue
    // computed re-running on an unrelated dependency does.
    const chain = deep();
    expect(layoutSuccessionGraph(chain)).toEqual(layoutSuccessionGraph(chain));
  });

  it("never reaches for Math.random", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("the layout must be deterministic");
    });
    try {
      expect(() => layoutSuccessionGraph(deep())).not.toThrow();
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("keeps a six-person board off itself", () => {
    // Grobelny's Związek Miast Polskich column, which is six people in one
    // column and one arrow each into the same node. Six circles at one x is
    // the shape a fan-out draws, and the only thing keeping them apart is the
    // collision force.
    const layout = layoutSuccessionGraph(grobelny(), { rowGap: 42 });
    const column = layout.nodes.filter((entry) => entry.column === -1);
    expect(column).toHaveLength(6);
    expect(new Set(column.map((entry) => entry.x)).size).toBe(1);

    const ys = column.map((entry) => entry.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(42 - 0.01);
    }
    // And the focus person, alone in their column, sits level with the middle
    // of the six rather than level with the first of them.
    const focus = layout.nodes.find((entry) => entry.focus)!;
    expect(focus.y).toBeCloseTo((ys[0]! + ys[5]!) / 2, 0);
  });

  it("survives the worst column in the register", () => {
    // Thirty candidates on one person is the measured maximum; the median is
    // two and the ninety-ninth percentile thirteen. A column that tall has to
    // stay legible rather than pack.
    const focus = node();
    // Distinct letters and no digits: `idOf` keeps only letters, so thirty
    // people called „Kandydat 1..30” would be thirty copies of one id, one key
    // and - the failure this caught when it was written that way - thirty
    // circles at one point that the overlap assertion below then measured as
    // zero apart.
    const names = Array.from({ length: 30 }, (_, i) => `Kandydat ${nth(i)}`);
    const layout = layoutSuccessionGraph([
      focus,
      ...open(focus, "successor", names),
    ]);

    expect(layout.nodes).toHaveLength(31);
    expect(layout.edges).toHaveLength(30);
    expect(closestPair(layout.nodes)).toBeGreaterThanOrEqual(42 - 0.01);
    // Tall enough to hold them: the component scrolls its own box rather than
    // squeezing thirty people into a fixed frame.
    expect(layout.height).toBeGreaterThan(29 * 42);
  });

  it("never lets two circles touch, at the shipped spacing", () => {
    const layout = layoutSuccessionGraph(grobelny());
    expect(closestPair(layout.nodes)).toBeGreaterThan(2 * layout.nodeRadius);
  });

  it("keeps every node inside the box it reports", () => {
    for (const chain of [grobelny(), deep(), [node()]]) {
      const layout = layoutSuccessionGraph(chain);
      for (const entry of layout.nodes) {
        expect(entry.x).toBeGreaterThanOrEqual(layout.nodeRadius);
        expect(entry.x).toBeLessThanOrEqual(layout.width - layout.nodeRadius);
        expect(entry.y).toBeGreaterThanOrEqual(layout.nodeRadius);
        // The label hangs below the circle and the box has to hold that too.
        expect(entry.y + layout.labelOffset).toBeLessThanOrEqual(layout.height);
      }
    }
  });

  it("carries what the register said about each hop", () => {
    const layout = layoutSuccessionGraph(deep());
    const pluta = layout.edges.find(
      (entry) =>
        entry.toKey === childKey("root", "successor", idOf("Marcin Pluta")),
    )!;
    expect(pluta.gapDays).toBe(23);
    // Through `gapLabel`, so the arrow and the card under it say the same
    // thing about the same two filings.
    expect(pluta.label).toBe(
      "Międzynarodowe Targi Poznańskie · Rada Nadzorcza · po 23 dniach przerwy",
    );
    expect(pluta.batched).toBe(false);
  });

  it("marks a hop the register filed as a batch", () => {
    // Six seats changed on one day, so the register does not say who replaced
    // whom - every one of these arrows is one of six equally good answers, and
    // drawing it like a one-to-one handover would claim more than that.
    const layout = layoutSuccessionGraph(grobelny());
    expect(layout.edges).toHaveLength(6);
    expect(layout.edges.every((entry) => entry.batched)).toBe(true);
    expect(layout.edges[0]!.label).toBe(
      "Związek Miast Polskich · Zarząd · tego samego dnia",
    );
  });

  it("weakens an arrow that rests on a batch anywhere", () => {
    // A merged candidate stands next to this person in two companies at once.
    // The closest filing is the clean one; the other is a same-day board
    // change, and the arrow is a single claim about the pair of them.
    const focus = node();
    const [merged] = open(focus, "predecessor", ["Jerzy Barzowski"], () => [
      via(MTP),
      via(ZMP, { batchSize: 6 }),
    ]);
    const layout = layoutSuccessionGraph([focus, merged!]);
    expect(layout.edges[0]!.label).toContain("Międzynarodowe Targi Poznańskie");
    expect(layout.edges[0]!.batched).toBe(true);
  });

  it("draws a hop it has no provenance for, bare rather than not at all", () => {
    // Unreachable through the UI - a child is only opened from a card on a
    // ready parent - but a chain whose parent had not settled would otherwise
    // lose an arrow, and a missing arrow is a worse lie than an unlabelled one.
    const focus = node({ predecessors: [], step: null, status: "pending" });
    const orphaned = node({
      key: childKey("root", "predecessor", idOf("Tadeusz Rozpara")),
      personId: idOf("Tadeusz Rozpara"),
      personName: "",
      parentKey: "root",
      direction: "predecessor",
      depth: 1,
      status: "pending",
      step: null,
    });
    const layout = layoutSuccessionGraph([focus, orphaned]);
    expect(layout.edges).toEqual([
      expect.objectContaining({
        fromKey: orphaned.key,
        toKey: "root",
        gapDays: null,
        label: null,
        batched: false,
      }),
    ]);
  });

  it("tells a person still on their way from one who may not be named", () => {
    // Two different facts behind one empty name, and the columns spend a
    // spinner on one and an em dash on the other. A third, an error, is a node
    // that failed rather than a person who is missing.
    const focus = node();
    const [pending, unnamable, failed] = open(focus, "successor", [
      "Marcin Pluta",
      "Tadeusz Rozpara",
      "Jerzy Barzowski",
    ]);
    const layout = layoutSuccessionGraph([
      focus,
      { ...pending!, personName: "", status: "pending", step: null },
      { ...unnamable!, personName: "", status: "ready" },
      { ...failed!, personName: "", status: "error", step: null },
    ]);
    const nodes = byKey(layout);

    expect(nodes.get(pending!.key)).toMatchObject({
      status: "pending",
      unnamable: false,
      name: "",
    });
    expect(nodes.get(unnamable!.key)).toMatchObject({
      status: "ready",
      unnamable: true,
      name: "",
    });
    expect(nodes.get(failed!.key)).toMatchObject({
      status: "error",
      unnamable: false,
      name: "",
    });
  });

  it("draws one human twice where two branches reached them", () => {
    // The chain is keyed by the path and not by the person, on purpose:
    // collapsing one branch must not collapse the other. Merging the two here
    // would give the simulation a single node with two parents and the reader
    // a graph that says something the columns do not.
    const focus = node();
    const [left] = open(focus, "predecessor", ["Tadeusz Rozpara"]);
    const [right] = open(focus, "successor", ["Marcin Pluta"]);
    const [underLeft] = open(left!, "predecessor", ["Jerzy Barzowski"]);
    const [underRight] = open(right!, "successor", ["Jerzy Barzowski"]);
    const layout = layoutSuccessionGraph([
      focus,
      left!,
      underLeft!,
      right!,
      underRight!,
    ]);

    const twice = layout.nodes.filter(
      (entry) => entry.personId === idOf("Jerzy Barzowski"),
    );
    expect(twice).toHaveLength(2);
    expect(twice[0]!.key).not.toBe(twice[1]!.key);
    // And they are two columns apart, on the two sides they were opened from.
    expect(twice.map((entry) => entry.column).sort()).toEqual([-2, 2]);
  });

  it("takes the focus from the chain rather than from the depth", () => {
    // The chain hands out a `focusKey` so no drawing has to know it is
    // "root"; passing it through is what would keep the picture right if the
    // chain ever re-rooted.
    const chain = deep();
    const layout = layoutSuccessionGraph(chain, {
      focusKey: chain[1]!.key,
    });
    expect(layout.nodes.filter((entry) => entry.focus)).toHaveLength(1);
    expect(layout.nodes.find((entry) => entry.focus)!.name).toBe(
      "Tadeusz Rozpara",
    );
  });
});

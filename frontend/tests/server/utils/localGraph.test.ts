import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLocalGraph } from "~~/server/utils/localGraph";

const { mockFetchNodesByIds, mockFetchEdgesClose } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  return { mockFetchNodesByIds: vi.fn(), mockFetchEdgesClose: vi.fn() };
});

vi.mock("~~/server/utils/fetch", () => ({
  fetchNodesByIds: mockFetchNodesByIds,
  fetchEdgesClose: mockFetchEdgesClose,
}));

type FakeNode = { id: string; name: string; type: string; visibility: boolean };
type FakeEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  visibility: boolean;
};

const node = (id: string, type: string): FakeNode => ({
  id,
  name: id,
  type,
  visibility: true,
});

const edge = (source: string, target: string, type: string): FakeEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  type,
  visibility: true,
});

/** Serves the mocks from a fixed world, and records what was asked for.
 *
 * `fetchEdgesClose` is the query the walk pays for, so the calls are the
 * assertion: what the second hop asks about is the whole of what this endpoint
 * costs beyond the first. */
function world(nodes: FakeNode[], edges: FakeEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  mockFetchEdgesClose.mockImplementation((ids: string[]) =>
    Promise.resolve(
      edges.filter((e) => ids.includes(e.source) || ids.includes(e.target)),
    ),
  );
  mockFetchNodesByIds.mockImplementation((ids: string[]) =>
    Promise.resolve(ids.map((id) => byId.get(id)).filter(Boolean)),
  );
}

const edgeCalls = () =>
  mockFetchEdgesClose.mock.calls.map(([ids]) => [...(ids as string[])].sort());
const nodeCalls = () =>
  mockFetchNodesByIds.mock.calls.map(([ids]) => [...(ids as string[])].sort());

describe("getLocalGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** p1 works at c1, and stood in an election in r1. p2 works at c1 too, and
   * r1 owns c2 as well as c1. */
  const NODES = [
    node("p1", "person"),
    node("p2", "person"),
    node("c1", "place"),
    node("c2", "place"),
    node("r1", "region"),
  ];
  const EDGES = [
    edge("p1", "c1", "employed"),
    edge("p1", "r1", "election"),
    edge("p2", "c1", "employed"),
    edge("r1", "c1", "owns"),
    edge("r1", "c2", "owns"),
  ];

  it("drops a removed relation even for a reader asking for drafts", async () => {
    // Removal is a different axis from approval: `showUnapproved` is the editor
    // asking to see what nobody has reviewed yet, not what somebody reviewed
    // and struck out. Without this an admin who removed a wrongly merged
    // employment still saw it on the page they removed it from.
    world(NODES, [
      ...EDGES,
      { ...edge("p1", "c2", "employed"), deleted: true } as FakeEdge,
    ]);

    const layout = await getLocalGraph("p1", true, 1, []);

    expect(layout.edges.map((e) => e.id)).not.toContain("p1-c2");
  });

  it("asks once and stops, at one hop", async () => {
    world(NODES, EDGES);

    const layout = await getLocalGraph("p1", true, 1, []);

    expect(edgeCalls()).toEqual([["p1"]]);
    expect(Object.keys(layout.nodes).sort()).toEqual(["c1", "p1", "r1"]);
  });

  it("walks the second hop one query at a time", async () => {
    world(NODES, EDGES);

    await getLocalGraph("p1", true, 2, []);

    // Two rounds of `fetchEdgesClose`, not one read of the whole collection.
    expect(edgeCalls()).toHaveLength(2);
    expect(edgeCalls()[0]).toEqual(["p1"]);
  });

  it("draws a region but does not spread through it", async () => {
    world(NODES, EDGES);

    const layout = await getLocalGraph("p1", true, 2, []);

    // r1 is a real relation of p1 and is drawn...
    expect(layout.nodes.r1).toBeDefined();
    // ...but it is not in the frontier, so the hundred other companies it owns
    // never enter the graph. That is the explosion the whole hop-by-hop fetch
    // exists to avoid, and it is cheapest to refuse at the frontier.
    expect(edgeCalls()[1]).toEqual(["c1"]);
    expect(layout.nodes.c2).toBeUndefined();
  });

  it("stamps each ring with how far out it is", async () => {
    world(NODES, EDGES);

    const layout = await getLocalGraph("p1", true, 2, []);

    expect(layout.nodes.p1?.depth).toBe(0);
    expect(layout.nodes.c1?.depth).toBe(1);
    expect(layout.nodes.r1?.depth).toBe(1);
    expect(layout.nodes.p2?.depth).toBe(2);
  });

  it("reads a node document once, not once per hop", async () => {
    world(NODES, EDGES);

    await getLocalGraph("p1", true, 2, []);

    // The walk reads what it discovered so it can decide where to go next; the
    // caller then asks only for what is left. Reading the first ring twice
    // would bill it twice on every uncached request.
    const asked = nodeCalls().flat();
    expect(asked).toEqual([...new Set(asked)]);
  });

  it("caps the frontier, and sorts before it cuts", async () => {
    // Fifty acquaintances is past `FRONTIER_LIMIT`. Which forty get expanded
    // has to be the same forty every time, or a cached response and a fresh one
    // disagree about what the graph is.
    const many = Array.from({ length: 50 }, (_, i) =>
      node(`f${String(i).padStart(2, "0")}`, "person"),
    );
    world(
      [node("p1", "person"), ...many],
      many.map((n) => edge("p1", n.id, "connection")),
    );

    await getLocalGraph("p1", true, 2, []);

    const frontier = edgeCalls()[1]!;
    expect(frontier).toHaveLength(40);
    expect(frontier).toEqual(many.slice(0, 40).map((n) => n.id));
  });

  it("gives every subject its own companies, not just the first one's", async () => {
    // The table's request. p2 shares nothing with p1, and its employer has to
    // come back all the same - "Firmy" was empty for every row but the first
    // when these arrived as expansions instead.
    world(
      [
        node("p1", "person"),
        node("p2", "person"),
        node("c1", "place"),
        node("c2", "place"),
      ],
      [edge("p1", "c1", "employed"), edge("p2", "c2", "employed")],
    );

    const layout = await getLocalGraph("p1", true, 1, [], ["p2"]);

    expect(Object.keys(layout.nodes).sort()).toEqual(["c1", "c2", "p1", "p2"]);
    // One hop from either subject, so the ring budget never gets a say.
    expect(layout.nodes.p2?.depth).toBe(0);
    expect(layout.nodes.c2?.depth).toBe(1);
    expect(layout.omitted).toBe(0);
  });

  it("shows what a reader expanded, at the one hop the canvas asks for", async () => {
    // "Rozwiń" on c1 with the depth control at one: p2 is a hop past the
    // horizon of p1's own graph, and that is the point of the button.
    world(NODES, EDGES);

    const layout = await getLocalGraph("p1", true, 1, ["c1"]);

    expect(layout.nodes.p2).toBeDefined();
    // A ring out from the subject, so it is drawn - and budgeted - as somebody
    // else's relation rather than p1's.
    expect(layout.nodes.c1?.depth).toBe(1);
    expect(layout.nodes.p2?.depth).toBe(2);
  });

  it("keeps a logged out reader from seeing an unapproved person", async () => {
    world(
      [node("p1", "person"), { ...node("p2", "person"), visibility: false }],
      [edge("p1", "p2", "connection")],
    );

    const layout = await getLocalGraph("p1", false, 2, []);

    expect(layout.nodes.p2).toBeUndefined();
  });

  it("refuses an id from the request that is a path, before reading anything", async () => {
    // `expand` and `subjects` are the caller's to type, and every id here is
    // read with `collection("nodes").doc(id)`, which takes `c1/x/y` as a path
    // below c1.
    world(NODES, EDGES);

    await expect(
      getLocalGraph("p1", false, 1, ["c1/x/y"]),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      getLocalGraph("p1", false, 1, [], ["p2", "p2/x"]),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockFetchEdgesClose).not.toHaveBeenCalled();
    expect(mockFetchNodesByIds).not.toHaveBeenCalled();
  });
});

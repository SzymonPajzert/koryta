import { describe, it, expect } from "vitest";
import { DiGraph } from "digraph-js";
import {
  getNodeGroups,
  getEdges,
  getNodesNoStats,
  getGraphBFS,
  pruneOuterRing,
} from "~~/shared/graph/util";
import type {
  Person,
  Company,
  Region,
  Edge as DBEdge,
  EdgeType,
} from "~~/shared/model";
import { SPLIT } from "~~/shared/graph/model";
import type { Edge, Node, NodeStats } from "~~/shared/graph/model";

/** `getNodeGroups` as it was until 2026-11-18, on digraph-js: what the linear
 * walk has to give, group for group and child for child. */
function digraphNodeGroups(
  nodesNoStats: Record<string, Node>,
  edges: Edge[],
  people: Record<string, Person>,
  companies: Record<string, Company>,
  regions: Record<string, Region>,
) {
  const placeConnection = new DiGraph();
  placeConnection.addVertices(
    ...Object.keys(nodesNoStats).flatMap((key) => [
      { id: key + SPLIT + "active", adjacentTo: [], body: {} },
      { id: key + SPLIT + "dead_end", adjacentTo: [], body: {} },
    ]),
  );
  edges.forEach((edge) => {
    if (!edge.traverse) return;
    if (edge.traverse.forward) {
      placeConnection.addEdge({
        from: edge.source + SPLIT + "active",
        to: edge.target + SPLIT + edge.traverse.forward,
      });
    }
    if (edge.traverse.backward) {
      placeConnection.addEdge({
        from: edge.target + SPLIT + "active",
        to: edge.source + SPLIT + edge.traverse.backward,
      });
    }
  });
  const entries = Object.entries({ ...companies, ...regions, ...people }).map(
    ([placeID, place]) => {
      const children = [
        ...placeConnection.getDeepChildren(placeID + SPLIT + "active"),
      ]
        .map((extendedID) => extendedID.split(SPLIT)[0])
        .filter((id) => !!id && !nodesNoStats[id]?.hide) as string[];
      return {
        id: placeID,
        name: place.name,
        connected: [placeID, ...children],
        stats: {
          people: children.filter(
            (node) => nodesNoStats[node]?.type === "circle",
          ).length,
        },
      };
    },
  );
  entries.push({
    id: "",
    name: "Wszystkie",
    connected: Object.keys(nodesNoStats),
    stats: { people: Object.keys(people).length },
  });
  return entries.sort((a, b) => b.stats.people - a.stats.people);
}

/** The same numbers for the same seed, every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every edge type, both ways each traverses, and one that has no policy. */
const EDGE_TYPES = [
  "employed",
  "connection",
  "mentions",
  "owns",
  "seat",
  "comment",
  "election",
  "tagged",
  "unknown",
] as EdgeType[];

/** People, places and regions, some hidden, an article that is no group's
 * root, and edges between them at random: loops, the same edge twice, an end
 * with no node, and a ring of ownership now and then. */
function randomGraph(random: () => number) {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const people: Record<string, Person> = {};
  const companies: Record<string, Company> = {};
  const regions: Record<string, Region> = {};
  const ids: string[] = [];
  const size = 1 + Math.floor(random() * 30);
  for (let i = 0; i < size; i++) {
    const kind = pick(["person", "place", "region"] as const);
    const id = `${kind}-${i}`;
    const node = {
      name: id,
      type: kind,
      ...(random() < 0.15 ? { hide: true } : {}),
    };
    if (kind === "person") people[id] = node as unknown as Person;
    else if (kind === "place") companies[id] = node as unknown as Company;
    else regions[id] = node as unknown as Region;
    ids.push(id);
  }
  const nodesNoStats: Record<string, Node> = {
    ...getNodesNoStats(people, companies, regions, {}),
    article: { name: "article", type: "document", color: "" },
  };
  const ends = [...ids, "article", "missing"];
  const raw: DBEdge[] = [];
  const count = Math.floor(random() * size * 3);
  for (let i = 0; i < count; i++) {
    const source = pick(ends);
    const target = random() < 0.1 ? source : pick(ends);
    raw.push({ id: `e${i}`, source, target, type: pick(EDGE_TYPES) } as DBEdge);
    if (random() < 0.1) raw.push({ ...raw[raw.length - 1]!, id: `e${i}-2` });
  }
  if (size >= 3 && random() < 0.5) {
    const ring = [pick(ids), pick(ids), pick(ids)];
    ring.forEach((source, i) => {
      const target = ring[(i + 1) % ring.length]!;
      raw.push({ id: `ring${i}`, source, target, type: "owns" } as DBEdge);
    });
  }
  return { nodesNoStats, edges: getEdges(raw), people, companies, regions };
}

describe("graph utils", () => {
  describe("getNodeGroups", () => {
    it("should include candidate in region but not candidate's outside connections via election edge", () => {
      // Mock data
      const people: Record<string, Person> = {
        p1: {
          name: "Candidate",
          parties: [] as string[],
          type: "person",
        } as Person,
        p2: {
          name: "Candidate Friend",
          parties: [] as string[],
          type: "person",
        } as Person,
      };
      const companies: Record<string, Company> = {};
      const regions: Record<string, Region> = {
        r1: { name: "Region", type: "region" } as Region,
      };

      const partyColors = {};
      const nodesNoStats = getNodesNoStats(
        people,
        companies,
        regions,
        partyColors,
      );

      // Candidate ran in Region
      const edgeElection: DBEdge = {
        id: "e1",
        source: "p1",
        target: "r1",
        type: "election",
        content: "",
        name: "test",
        visibility: "public",
        references: [],
      };

      // Candidate knows Candidate Friend
      const edgeConnection: DBEdge = {
        id: "e2",
        source: "p1",
        target: "p2",
        type: "connection",
        content: "",
        name: "zna",
        visibility: "public",
        references: [],
      };

      const edges = getEdges([edgeElection, edgeConnection]);

      const groups = getNodeGroups(
        nodesNoStats,
        edges,
        people,
        companies,
        regions,
      );

      const regionGroup = groups.find((g) => g.id === "r1");
      expect(regionGroup).toBeDefined();

      // The region group should include the Region and Candidate
      expect(regionGroup?.connected).toContain("r1");
      expect(regionGroup?.connected).toContain("p1");

      // The region group should NOT include the Candidate's Friend!
      // This verifies that `backward: "dead_end"` correctly stopped the traversal at the Candidate
      expect(regionGroup?.connected).not.toContain("p2");
    });

    /** The walk replaced digraph-js's, which was quadratic in the nodes, and
     * every group has to come out as it did: the same children in the same
     * order, and the same count of people. */
    it("groups every node as the digraph-js walk did", () => {
      let reachedPeople = 0;
      let backToTheRoot = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const { nodesNoStats, edges, people, companies, regions } = randomGraph(
          seeded(seed),
        );

        const groups = getNodeGroups(
          nodesNoStats,
          edges,
          people,
          companies,
          regions,
        );

        expect(groups, `seed ${seed}`).toEqual(
          digraphNodeGroups(nodesNoStats, edges, people, companies, regions),
        );
        for (const group of groups) {
          if (group.id === "") continue;
          reachedPeople += group.stats.people;
          if (group.connected.slice(1).includes(group.id)) backToTheRoot++;
        }
      }
      // The graphs reach somebody, and some lead back to where they started.
      expect(reachedPeople).toBeGreaterThan(0);
      expect(backToTheRoot).toBeGreaterThan(0);
    });
  });

  describe("getNodesNoStats", () => {
    it("should preserve original DB type via entityType and overwrite Graph type for visual rendering", () => {
      const people: Record<string, Person> = {
        p1: { name: "Person A", type: "person" } as Person,
      };
      const companies: Record<string, Company> = {
        c1: { name: "Company B", type: "place" } as Company,
      };
      const regions: Record<string, Region> = {
        r1: { name: "Region C", type: "region" } as Region,
      };

      const nodesNoStats = getNodesNoStats(people, companies, regions, {});

      // Verify the person node
      expect(nodesNoStats["p1"]).toBeDefined();
      expect(nodesNoStats["p1"].type).toBe("circle");
      expect((nodesNoStats["p1"] as any).entityType).toBe("person");

      // Verify the company/place node
      expect(nodesNoStats["c1"]).toBeDefined();
      expect(nodesNoStats["c1"].type).toBe("rect");
      expect((nodesNoStats["c1"] as any).entityType).toBe("place");

      // Verify the region node
      expect(nodesNoStats["r1"]).toBeDefined();
      expect(nodesNoStats["r1"].type).toBe("document");
      expect((nodesNoStats["r1"] as any).entityType).toBe("region");
    });

    it("draws no node for a topic, so a tagged edge cannot reach the canvas", () => {
      // `getLocalGraph` keeps only the edges whose *both* ends are in here, so
      // this absence is what stops `tagged` edges - article to topic, neither
      // of them a graph node - from ever being drawn. The `dead_end` policy
      // below is the second line of defence, for whoever later decides a topic
      // should be visible.
      const nodesNoStats = getNodesNoStats(
        { p1: { name: "Person A", type: "person" } as Person },
        {},
        {},
        {},
      );

      expect(Object.keys(nodesNoStats)).toEqual(["p1"]);
    });
  });

  describe("a founder's edge", () => {
    const owns: DBEdge = {
      id: "o1",
      source: "arp",
      target: "fundacja",
      type: "owns",
    } as DBEdge;

    it("keeps the mark and is labelled as the founder's", () => {
      const [edge] = getEdges([{ ...owns, founder: true }]);

      expect(edge!.founder).toBe(true);
      expect(edge!.label).toBe("fundator");
      // Still ownership to everything that walks the graph.
      expect(edge!.type).toBe("owns");
    });

    it("adds nothing to an ordinary ownership edge", () => {
      const [edge] = getEdges([owns]);

      expect(edge).not.toHaveProperty("founder");
      expect(edge!.label).toBe("właściciel");
    });
  });

  describe("a post a declaration names", () => {
    const job: DBEdge = {
      id: "j1",
      source: "p1",
      target: "starostwo",
      type: "employed",
      name: "wicestarosta",
    } as DBEdge;

    it("carries its age and what a page reads of each entry, nothing else", () => {
      const [edge] = getEdges([
        {
          ...job,
          as_of: "2024",
          declared: {
            "f00d-p1:employer:0": {
              url: "https://bip.example.pl/oswiadczenie.pdf",
              as_of: "2024",
              kind: "annual",
              band: "employer",
              role: "wicestarosta",
              roleId: "wicestarosta",
              start: "2019-11-21",
              by: "readers",
              readers: 2,
              at: "2026-11-20T12:00:00.000Z",
              income: [
                {
                  amount: 12345678,
                  currency: "PLN",
                  from: "2024-01-01",
                  to: "2024-12-31",
                  measure: "dochod",
                  gross: null,
                  kind: "pay",
                  line: "f00d-p1:viii:0",
                  part: 0,
                  partRole: "single",
                },
              ],
            },
          },
        },
      ]);

      expect(edge!.as_of).toBe("2024");
      // Who read it, how it settled and what it pays stay on the edge.
      expect(edge!.declared).toEqual({
        "f00d-p1:employer:0": {
          url: "https://bip.example.pl/oswiadczenie.pdf",
          as_of: "2024",
          kind: "annual",
          role: "wicestarosta",
          start: "2019-11-21",
        },
      });
    });

    it("adds nothing to a post no declaration names", () => {
      const [edge] = getEdges([job]);

      expect(edge).not.toHaveProperty("as_of");
      expect(edge).not.toHaveProperty("declared");
    });
  });

  describe("tagged edges", () => {
    const taggedEdge: DBEdge = {
      id: "t1",
      source: "a1",
      target: "topic1",
      type: "tagged",
    } as DBEdge;

    it("is a dead end in both directions", () => {
      const [edge] = getEdges([taggedEdge]);

      // Not a stylistic choice. A topic is joined to every article in its
      // story, so a traversable `tagged` edge makes the topic a hub two hops
      // wide and every person mentioned anywhere in an affair reads as
      // connected to every other one.
      expect(edge!.traverse).toEqual({
        forward: "dead_end",
        backward: "dead_end",
      });
    });

    it("does not connect two people who share a topic", () => {
      // The arrangement the policy exists to prevent: two unrelated people,
      // each mentioned by an article, both articles under one topic.
      const people: Record<string, Person> = {
        p1: { name: "Person A", type: "person" } as Person,
        p2: { name: "Person B", type: "person" } as Person,
      };
      const nodesNoStats = {
        ...getNodesNoStats(people, {}, {}, {}),
        a1: { name: "Article 1", type: "document", color: "" } as never,
        a2: { name: "Article 2", type: "document", color: "" } as never,
        topic1: {
          name: "Powodzianie KRR",
          type: "document",
          color: "",
        } as never,
      };

      const edges = getEdges([
        { id: "m1", source: "a1", target: "p1", type: "mentions" } as DBEdge,
        { id: "m2", source: "a2", target: "p2", type: "mentions" } as DBEdge,
        { id: "t1", source: "a1", target: "topic1", type: "tagged" } as DBEdge,
        { id: "t2", source: "a2", target: "topic1", type: "tagged" } as DBEdge,
      ]);

      const groups = getNodeGroups(nodesNoStats, edges, people, {}, {});
      const forPerson1 = groups.find((group) => group.id === "p1");

      expect(forPerson1?.connected).not.toContain("p2");
    });
  });
});

/** A node as `getNodes` hands it on, which is what both functions below take. */
const drawn = (
  name: string,
  type: Node["type"] = "circle",
): Node & { stats: NodeStats } => ({
  name,
  type,
  color: "#000000",
  stats: { people: 0 },
});

const spell = (source: string, target: string, endDate?: string): Edge => ({
  source,
  target,
  type: "employed",
  end_date: endDate,
});

describe("getGraphBFS", () => {
  // F -- A -- x, and A -- B, so B is two hops out and y three.
  const nodes = {
    F: drawn("Focus"),
    A: drawn("Employer", "rect"),
    B: drawn("Colleague"),
    y: drawn("Colleague of a colleague"),
    away: drawn("Nobody"),
  };
  const edges = [spell("F", "A"), spell("B", "A"), spell("B", "y")];

  it("stamps every node with how far out it sits", () => {
    const result = getGraphBFS(["F"], [], 2, edges, nodes);

    expect(result.F?.depth).toBe(0);
    expect(result.A?.depth).toBe(1);
    expect(result.B?.depth).toBe(2);
  });

  it("stops at the depth it was asked for, and keeps nothing unreachable", () => {
    const result = getGraphBFS(["F"], [], 2, edges, nodes);

    expect(Object.keys(result).sort()).toEqual(["A", "B", "F"]);
  });

  it("draws one hop the way it always did", () => {
    const result = getGraphBFS(["F"], [], 1, edges, nodes);

    expect(Object.keys(result).sort()).toEqual(["A", "F"]);
  });

  it("starts an expanded node one ring out, not at the subject's", () => {
    // A page has one subject. Drawing the node a reader asked to see more of
    // at depth nought would give it the subject's size, ring and label, which
    // says the page is about it.
    const result = getGraphBFS(["F"], ["B"], 2, edges, nodes);

    expect(result.F?.depth).toBe(0);
    expect(result.B?.depth).toBe(1);
    // And whatever the expansion reveals lands in the outer ring, where the
    // budget can reach it.
    expect(result.y?.depth).toBe(2);
  });

  it("ignores an expansion of the subject itself", () => {
    const result = getGraphBFS(["F"], ["F"], 2, edges, nodes);

    expect(result.F?.depth).toBe(0);
  });

  it("walks an expansion at the one hop the canvas asks for by default", () => {
    // "Rozwiń" on a person's page, where the depth control sits at one. The
    // node the reader clicked is stamped a ring out, but it still gets to
    // reveal something - seeding it at depth one against a limit of one left
    // it finished before it started, and the button did nothing at all.
    const result = getGraphBFS(["F"], ["B"], 1, edges, nodes);

    expect(result.B?.depth).toBe(1);
    expect(result.y?.depth).toBe(2);
  });

  it("gives every subject its own neighbourhood, all on the same ring", () => {
    // The table's request: a page of rows, none of them a footnote to the
    // first. `B` is not related to `F`, and its employer has to come back
    // anyway.
    const result = getGraphBFS(["F", "B"], [], 1, edges, nodes);

    expect(result.F?.depth).toBe(0);
    expect(result.B?.depth).toBe(0);
    expect(result.A?.depth).toBe(1);
    expect(result.y?.depth).toBe(1);
  });

  it("keeps a subject's own ring out of the outer one", () => {
    // Which is what keeps `pruneOuterRing` off a page of table rows: a one hop
    // graph is never thinned.
    const result = getGraphBFS(["F", "B"], [], 1, edges, nodes);
    const depths = Object.values(result).map((n) => n.depth);

    expect(Math.max(...depths)).toBe(1);
  });
});

describe("pruneOuterRing", () => {
  /** One person, two employers, and four other people spread across them.
   *
   * `shared` sits on both boards, `a2`'s spell is still open, `a1`'s and `b1`'s
   * have ended. That is one of each thing the ranking is supposed to notice. */
  const nodes = {
    F: { ...drawn("Focus"), depth: 0 },
    A: { ...drawn("Aleja", "rect"), depth: 1 },
    B: { ...drawn("Brama", "rect"), depth: 1 },
    shared: { ...drawn("Na obu radach"), depth: 2 },
    a1: { ...drawn("Dawny kolega"), depth: 2 },
    a2: { ...drawn("Obecny kolega"), depth: 2 },
    b1: { ...drawn("Jedyny z Bramy"), depth: 2 },
  };
  const edges = [
    spell("F", "A"),
    spell("F", "B"),
    spell("shared", "A", undefined),
    spell("shared", "B", undefined),
    spell("a1", "A", "2019-01-01"),
    spell("a2", "A"),
    spell("b1", "B", "2019-01-01"),
  ];

  it("leaves a one hop graph exactly as it is", () => {
    // The page's own relations, every one of which the rows above the graph
    // list by name. Cutting those would be cutting the page.
    const oneHop = {
      F: { ...drawn("Focus"), depth: 0 },
      A: { ...drawn("Aleja", "rect"), depth: 1 },
    };

    expect(pruneOuterRing(oneHop, edges, 1)).toEqual({
      nodes: oneHop,
      omitted: 0,
    });
  });

  it("does nothing when the ring already fits", () => {
    const result = pruneOuterRing(nodes, edges, 10);

    expect(result.nodes).toEqual(nodes);
    expect(result.omitted).toBe(0);
  });

  it("keeps the whole of the inner rings", () => {
    const result = pruneOuterRing(nodes, edges, 1);

    expect(result.nodes.F).toBeDefined();
    expect(result.nodes.A).toBeDefined();
    expect(result.nodes.B).toBeDefined();
  });

  it("gives every relation a turn before any of them gets a second", () => {
    // Three seats. A could fill all three on its own; B has one candidate and
    // gets to place them, because "who else is at Brama" is a different fact
    // from "a third person at Aleja".
    const result = pruneOuterRing(nodes, edges, 3);

    expect(result.nodes.b1).toBeDefined();
    expect(Object.keys(result.nodes)).toHaveLength(6);
  });

  it("lets one relation fill the ring when no other is competing for it", () => {
    // Somebody who sits on exactly one board should see that board, not a
    // fixed handful of it. Fairness is what the round robin is for, and with a
    // single sponsor there is nobody to be fair to.
    const oneBoard = {
      F: { ...drawn("Focus"), depth: 0 },
      A: { ...drawn("Aleja", "rect"), depth: 1 },
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [
          `c${i}`,
          { ...drawn(`Kolega ${i}`), depth: 2 },
        ]),
      ),
    };
    const oneBoardEdges = [
      spell("F", "A"),
      ...Array.from({ length: 9 }, (_, i) => spell(`c${i}`, "A")),
    ];

    const result = pruneOuterRing(oneBoard, oneBoardEdges, 6);

    expect(
      Object.values(result.nodes).filter((node) => node.depth === 2),
    ).toHaveLength(6);
    expect(result.omitted).toBe(3);
  });

  it("prefers whoever is reached by more than one of the relations", () => {
    const result = pruneOuterRing(nodes, edges, 3);

    expect(result.nodes.shared).toBeDefined();
  });

  it("prefers an open spell to one that has ended", () => {
    const result = pruneOuterRing(nodes, edges, 3);

    expect(result.nodes.a2).toBeDefined();
    expect(result.nodes.a1).toBeUndefined();
  });

  it("says how many it left out", () => {
    expect(pruneOuterRing(nodes, edges, 3).omitted).toBe(1);
  });

  it("cuts the same graph the same way twice", () => {
    // A cached response and a fresh one have to agree, and the ordering the
    // ranking falls back on is the only thing holding that.
    const first = pruneOuterRing(nodes, edges, 2);
    const second = pruneOuterRing(nodes, edges, 2);

    expect(Object.keys(first.nodes)).toEqual(Object.keys(second.nodes));
  });
});

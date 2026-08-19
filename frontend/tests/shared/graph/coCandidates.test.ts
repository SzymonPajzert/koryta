import { describe, it, expect } from "vitest";
import {
  coCandidateEdges,
  withCoCandidates,
  MAX_LIST_MEMBERS,
  MAX_CO_CANDIDATE_EDGES,
} from "~~/shared/graph/coCandidates";
import { getNodeGroups } from "~~/shared/graph/util";
import type { Edge, Node } from "~~/shared/graph/model";
import type { Person, Region } from "~~/shared/model";

function person(name: string): Node {
  return { name, type: "circle", color: "#000", entityType: "person" };
}

function region(name: string): Node {
  return { name, type: "document", color: "green", entityType: "region" };
}

/** A stored candidacy: person -> region, with the committee the ingest writes. */
function candidacy(
  source: string,
  target: string,
  committee: string | undefined,
  year: string,
  position = "Rada gminy",
): Edge {
  const edge: Edge = {
    id: `${source}-${target}-${year}`,
    source,
    target,
    type: "election",
    name: "kandydatura",
    start_date: `${year}-01-01`,
    position: position as Edge["position"],
  };
  if (committee) edge.committee = committee;
  return edge;
}

const twoOnOneList: Node[] = [person("Anna Nowak"), person("Jan Kowalski")];

const nodes = {
  p1: twoOnOneList[0]!,
  p2: twoOnOneList[1]!,
  r1: region("Gmina A"),
};

describe("coCandidateEdges", () => {
  it("joins two people who stood on the same list", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2024"),
        candidacy("p2", "r1", "KW Przykład", "2024"),
      ],
      nodes,
    );

    expect(derived).toHaveLength(1);
    expect(derived[0]!.source).toBe("p1");
    expect(derived[0]!.target).toBe("p2");
    expect(derived[0]!.type).toBe("co_candidate");
    expect(derived[0]!.label).toBe("wspólna lista 2024");
    expect(derived[0]!.content).toContain("KW Przykład (2024)");
  });

  it("draws nothing for candidacies with no committee", () => {
    // The state of every one of the 10,476 stored candidacies as of the
    // 2026-08-11 export: the district and the year are all we hold, and those
    // two ran in the same gmina in the same year without necessarily standing
    // together. The feature is meant to be silent until a re-ingest fills the
    // committee in, and this is the test that keeps it silent.
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", undefined, "2024"),
        candidacy("p2", "r1", undefined, "2024"),
      ],
      nodes,
    );

    expect(derived).toEqual([]);
  });

  it("keeps rival committees apart", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2024"),
        candidacy("p2", "r1", "KW Inny", "2024"),
      ],
      nodes,
    );

    expect(derived).toEqual([]);
  });

  it("keeps the same committee in different years and places apart", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2018"),
        candidacy("p2", "r1", "KW Przykład", "2024"),
        candidacy("p1", "r2", "KW Przykład", "2024"),
      ],
      { ...nodes, r2: region("Gmina B") },
    );

    expect(derived).toEqual([]);
  });

  it("keeps a committee's mayoral candidate off its council list", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2024", "Rada gminy"),
        candidacy("p2", "r1", "KW Przykład", "2024", "Wójt"),
      ],
      nodes,
    );

    expect(derived).toEqual([]);
  });

  it("treats committee names differing only in case and spacing as one", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW  Przykład", "2024"),
        candidacy("p2", "r1", "kw przykład", "2024"),
      ],
      nodes,
    );

    expect(derived).toHaveLength(1);
  });

  it("draws one edge for a pair that shared several lists", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2018"),
        candidacy("p2", "r1", "KW Przykład", "2018"),
        candidacy("p1", "r1", "KW Przykład", "2024"),
        candidacy("p2", "r1", "KW Przykład", "2024"),
      ],
      nodes,
    );

    expect(derived).toHaveLength(1);
    expect(derived[0]!.label).toBe("wspólne listy (2)");
    // Most recent first, and the committee is left off the edge because two
    // different ones could have produced it.
    expect(derived[0]!.content).toBe(
      "Wspólne listy wyborcze: KW Przykład (2024); KW Przykład (2018)",
    );
    expect(derived[0]!.committee).toBeUndefined();
  });

  it("leaves a pair alone when a recorded relation already joins them", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2024"),
        candidacy("p2", "r1", "KW Przykład", "2024"),
        { id: "c1", source: "p2", target: "p1", type: "connection" },
      ],
      nodes,
    );

    expect(derived).toEqual([]);
  });

  it("draws nothing for a person whose co-candidate is not on the page", () => {
    // A person's own graph at distance 1: their district is there, whoever
    // else stood in it is a hop further out. This is the "both on the page"
    // rule, and it is what stops a district becoming a clique.
    const derived = coCandidateEdges(
      [candidacy("p1", "r1", "KW Przykład", "2024")],
      { p1: nodes.p1, r1: nodes.r1 },
    );

    expect(derived).toEqual([]);
  });

  it("counts a duplicated candidacy once, and never pairs a person with themselves", () => {
    const derived = coCandidateEdges(
      [
        candidacy("p1", "r1", "KW Przykład", "2024"),
        { ...candidacy("p1", "r1", "KW Przykład", "2024"), id: "duplicate" },
      ],
      nodes,
    );

    expect(derived).toEqual([]);
  });

  it("reads the candidacy the other way round too", () => {
    // Nothing writes region -> person today, but the group key is built from
    // whichever end is not the person, so an edge drawn backwards must not key
    // its group on a person and start pairing up regions.
    const derived = coCandidateEdges(
      [
        {
          ...candidacy("p1", "r1", "KW Przykład", "2024"),
          source: "r1",
          target: "p1",
        },
        {
          ...candidacy("p2", "r1", "KW Przykład", "2024"),
          source: "r1",
          target: "p2",
        },
      ],
      nodes,
    );

    expect(derived).toHaveLength(1);
    expect([derived[0]!.source, derived[0]!.target]).toEqual(["p1", "p2"]);
  });

  it("drops a group too large to be one list", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_LIST_MEMBERS + 1 }, (_, i) => [
        `p${i}`,
        person(`Osoba ${i}`),
      ]),
    );
    const edges = Object.keys(many).map((id) =>
      candidacy(id, "r1", "KWW", "2024"),
    );

    expect(coCandidateEdges(edges, { ...many, r1: region("Gmina A") })).toEqual(
      [],
    );
    // One member fewer and it is a list again - all of its pairs, up to the
    // render cap.
    expect(
      coCandidateEdges(edges.slice(1), { ...many, r1: region("Gmina A") }),
    ).toHaveLength(
      Math.min(
        (MAX_LIST_MEMBERS * (MAX_LIST_MEMBERS - 1)) / 2,
        MAX_CO_CANDIDATE_EDGES,
      ),
    );
  });

  it("caps how many derived edges one layout carries, smallest lists first", () => {
    // Enough full-size lists to blow past the cap several times over. The small
    // list is the informative one, so it has to survive.
    const nodesMany: Record<string, Node> = { r1: region("Gmina A") };
    const edges: Edge[] = [];
    for (let list = 0; list < 4; list++) {
      for (let i = 0; i < MAX_LIST_MEMBERS; i++) {
        const id = `l${list}p${i}`;
        nodesMany[id] = person(`Osoba ${list}-${i}`);
        edges.push(candidacy(id, "r1", `KW ${list}`, "2024"));
      }
    }
    nodesMany.small1 = person("Mała Lista A");
    nodesMany.small2 = person("Mała Lista B");
    edges.push(candidacy("small1", "r1", "KW Mały", "2024"));
    edges.push(candidacy("small2", "r1", "KW Mały", "2024"));

    const derived = coCandidateEdges(edges, nodesMany);

    expect(derived).toHaveLength(MAX_CO_CANDIDATE_EDGES);
    expect(
      derived.some((e) => e.source === "small1" && e.target === "small2"),
    ).toBe(true);
  });
});

describe("withCoCandidates", () => {
  const layout = {
    edges: [
      candidacy("p1", "r1", "KW Przykład", "2024"),
      candidacy("p2", "r1", "KW Przykład", "2024"),
    ],
    nodes: {
      p1: { ...nodes.p1, stats: { people: 0 } },
      p2: { ...nodes.p2, stats: { people: 0 } },
      r1: { ...nodes.r1, stats: { people: 2 } },
    },
    nodeGroups: [],
  };

  it("appends the derived edges and leaves the stored ones alone", () => {
    const result = withCoCandidates(layout);

    expect(result.edges).toHaveLength(3);
    expect(result.edges.slice(0, 2)).toEqual(layout.edges);
    expect(result.edges[2]!.type).toBe("co_candidate");
    expect(result.nodes).toBe(layout.nodes);
  });

  it("does not make two people on one list count as connected", () => {
    // The `tagged` failure mode, one edge type over: a line between list-mates
    // that `getNodeGroups` looks at would fold everyone who ever shared a
    // committee into one node group, and the people counts on region and
    // company nodes are read off those groups. `dead_end` is not enough here -
    // it stops the walk past the far end, not at it - so a derived edge
    // carries no traverse policy at all, and `getNodeGroups` skips it.
    const people: Record<string, Person> = {
      p1: { name: "Anna Nowak", type: "person" } as Person,
      p2: { name: "Jan Kowalski", type: "person" } as Person,
    };
    const regions: Record<string, Region> = {
      r1: { name: "Gmina A", type: "region" } as Region,
    };
    const nodesNoStats = { p1: nodes.p1, p2: nodes.p2, r1: nodes.r1 };

    const derived = coCandidateEdges(layout.edges, nodesNoStats);
    expect(derived).toHaveLength(1);
    expect(derived[0]!.traverse).toBeUndefined();

    const groups = getNodeGroups(
      nodesNoStats,
      [...layout.edges, ...derived],
      people,
      {},
      regions,
    );

    expect(groups.find((g) => g.id === "p1")?.connected).not.toContain("p2");
  });
});

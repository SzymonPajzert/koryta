import { describe, it, expect } from "vitest";
import {
  generateConnectionsPuzzle,
  connectionsPuzzleNumber,
  connectionsGroupKinds,
  hashSeed,
  type ConnectionsCandidate,
  type ConnectionsLabelers,
} from "../../shared/games/connections";

function candidate(
  id: string,
  fields: Partial<Omit<ConnectionsCandidate, "id" | "name">> = {},
): ConnectionsCandidate {
  return {
    id,
    name: `Osoba ${id}`,
    parties: [],
    companies: [],
    regions: [],
    years: [],
    ...fields,
  };
}

const labelers: ConnectionsLabelers = {
  company: (id) => (id === "c1" ? "Spółka Testowa" : undefined),
  region: (id) => (id === "r1" ? "Testowo" : undefined),
};

/** One clean pool of four people per group kind. */
function cleanCandidates(): ConnectionsCandidate[] {
  return [
    ...["p1", "p2", "p3", "p4"].map((id) =>
      candidate(id, { parties: ["PiS"] }),
    ),
    ...["y1", "y2", "y3", "y4"].map((id) => candidate(id, { years: ["2023"] })),
    ...["g1", "g2", "g3", "g4"].map((id) => candidate(id, { regions: ["r1"] })),
    ...["k1", "k2", "k3", "k4"].map((id) =>
      candidate(id, { companies: ["c1"] }),
    ),
  ];
}

describe("generateConnectionsPuzzle", () => {
  it("builds a full board from minimal pools", () => {
    const puzzle = generateConnectionsPuzzle(
      "2026-07-27",
      cleanCandidates(),
      labelers,
    );

    expect(puzzle).not.toBeNull();
    expect(puzzle!.people).toHaveLength(16);
    expect(new Set(puzzle!.people.map((tile) => tile.id)).size).toBe(16);
    expect(puzzle!.groups.map((group) => group.kind)).toEqual([
      ...connectionsGroupKinds,
    ]);
    const company = puzzle!.groups.find((group) => group.kind === "company")!;
    expect(company.label).toBe("Pracowali w: Spółka Testowa");
    expect([...company.personIds].sort()).toEqual(["k1", "k2", "k3", "k4"]);
  });

  it("is deterministic for a date and varies between dates", () => {
    const first = generateConnectionsPuzzle(
      "2026-07-27",
      cleanCandidates(),
      labelers,
    );
    const second = generateConnectionsPuzzle(
      "2026-07-27",
      cleanCandidates(),
      labelers,
    );
    const other = generateConnectionsPuzzle(
      "2026-07-28",
      cleanCandidates(),
      labelers,
    );

    expect(first).toEqual(second);
    expect(other!.people).not.toEqual(first!.people);
  });

  it("keeps people matching two selected groups off the board", () => {
    // k5 works at c1 but is also in PiS — with both groups on the board the
    // solution would be ambiguous, so k5 must be skipped.
    const candidates = [
      ...cleanCandidates(),
      candidate("k5", { companies: ["c1"], parties: ["PiS"] }),
    ];

    const puzzle = generateConnectionsPuzzle("2026-07-27", candidates, {
      ...labelers,
    });

    expect(puzzle).not.toBeNull();
    expect(puzzle!.people.map((tile) => tile.id)).not.toContain("k5");
  });

  it("returns null when a group kind has no pool of four", () => {
    const candidates = cleanCandidates().filter((c) => c.id !== "k4");
    expect(
      generateConnectionsPuzzle("2026-07-27", candidates, labelers),
    ).toBeNull();
  });

  it("skips pools whose label cannot be resolved", () => {
    // c2 has four members but no known name; c1 must be picked instead.
    const candidates = [
      ...cleanCandidates(),
      ...["m1", "m2", "m3", "m4"].map((id) =>
        candidate(id, { companies: ["c2"] }),
      ),
    ];

    const puzzle = generateConnectionsPuzzle(
      "2026-07-27",
      candidates,
      labelers,
    );

    expect(puzzle).not.toBeNull();
    const company = puzzle!.groups.find((group) => group.kind === "company")!;
    expect(company.key).toBe("c1");
  });
});

describe("connectionsPuzzleNumber", () => {
  it("counts days since the first puzzle", () => {
    expect(connectionsPuzzleNumber("2026-07-27")).toBe(1);
    expect(connectionsPuzzleNumber("2026-08-03")).toBe(8);
  });
});

describe("hashSeed", () => {
  it("is stable and distinguishes inputs", () => {
    expect(hashSeed("polaczenia:2026-07-27")).toBe(
      hashSeed("polaczenia:2026-07-27"),
    );
    expect(hashSeed("polaczenia:2026-07-27")).not.toBe(
      hashSeed("polaczenia:2026-07-28"),
    );
  });
});

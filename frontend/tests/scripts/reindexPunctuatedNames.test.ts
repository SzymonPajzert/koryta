import { describe, it, expect } from "vitest";
import {
  checkVerdict,
  plan,
} from "../../scripts/migrate/reindex-punctuated-names";
import { generateChunksLower, townChunk } from "~~/shared/search";

/** A node as stored before 2026-10-28: its index cut by trimming, flattening
 * and lowercasing alone, which is what `generateChunksLower` did with a
 * hyphen-free name before `searchableText`. */
function stored(
  id: string,
  name: string,
  type = "place",
  extra: Record<string, unknown> = {},
) {
  const lower = name.trim().replace(/\s+/g, " ").toLowerCase();
  const words = lower.split(" ");
  const old = new Set([""]);
  for (let i = 1; i <= lower.length; i++) old.add(lower.slice(0, i));
  if (words.length > 1) {
    for (const word of words) {
      for (let i = 1; i <= word.length; i++) old.add(word.slice(0, i));
    }
  }
  return {
    id,
    data: { type, name, nameChunksLower: [...old], ...extra },
  };
}

describe("plan", () => {
  it("re-indexes a name with a quote and a bracketed town", () => {
    const name = 'PRZEDSIĘBIORSTWO GOSPODARKI KOMUNALNEJ "SANIKOM" (Lubawka)';
    const [one, ...rest] = plan([stored("pgk", name)]);
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ id: "pgk", type: "place", punctuated: true });
    expect(one!.chunks).toEqual(generateChunksLower(name, "place"));
    expect(one!.chunks).toContain("sanikom");
    expect(one!.chunks).toContain(townChunk("lubawka"));
  });

  it("re-indexes a region and a person the same way", () => {
    const rewrites = plan([
      stored("r", "Powiat świdnicki (Świdnica)", "region"),
      stored("p", "Kajetan Ludwik D'obyrn", "person"),
    ]);
    expect(rewrites.map((one) => [one.id, one.punctuated])).toEqual([
      ["r", true],
      ["p", true],
    ]);
  });

  it("leaves alone a name without punctuation", () => {
    // 15,967 of the 2026-10-28 export: the cut gives them the index they had.
    expect(
      plan([
        stored("a", "Anna Nowak", "person"),
        stored("o", "ORLEN"),
        stored("e", "Ewa Kukulska - Zając", "person"),
      ]),
    ).toEqual([]);
  });

  it("does not count what is out of date for another reason as punctuated", () => {
    expect(
      plan([
        {
          id: "pec",
          data: {
            type: "place",
            name: "PEC SPÓŁKA Z OGRANICZONĄ \nODPOWIEDZIALNOŚCIĄ",
            nameChunksLower: ["", "pec", "\nodpowiedzialnością"],
          },
        },
      ]),
    ).toMatchObject([{ id: "pec", punctuated: false }]);
  });

  it("does not look at what search does not read, or at a node with no name", () => {
    expect(
      plan([
        stored("art", 'Spółka "SANIKOM" (Lubawka)', "article"),
        stored("topic", "Wodociągi (Myślibórz)", "topic"),
        { id: "noname", data: { type: "place" } },
        { id: "empty", data: { type: "place", name: "" } },
      ]),
    ).toEqual([]);
  });

  it("finds nothing left once its own rewrites are stored", () => {
    // What the re-run after --commit has to report.
    const nodes = [
      stored("k", 'STADNINA KONI "KRASNE"'),
      stored("h", 'HUTA"KOŚCIUSZKO" W UPADŁOŚCI LIKWIDACYJNEJ (Chorzów)'),
    ];
    for (const one of plan(nodes)) {
      nodes.find((node) => node.id === one.id)!.data.nameChunksLower =
        one.chunks;
    }
    expect(plan(nodes)).toEqual([]);
  });
});

describe("checkVerdict", () => {
  const expected = generateChunksLower('STADNINA KONI "KRASNE"');
  const stale = expected.slice(0, -1);

  it("goes on once the trigger has completed the index", () => {
    expect(checkVerdict(expected, stale, expected)).toBe("done");
  });

  it("waits while the node still holds what was written", () => {
    expect(checkVerdict(stale, stale, expected)).toBe("waiting");
  });

  it("stops at an index the trigger worked out by another rule", () => {
    // What the trigger deployed before 2026-10-28 writes for the name.
    const old = stored("k", 'STADNINA KONI "KRASNE"').data.nameChunksLower;
    expect(checkVerdict(old, stale, expected)).toBe("old");
  });
});

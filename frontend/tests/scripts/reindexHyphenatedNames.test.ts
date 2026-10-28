import { describe, it, expect } from "vitest";
import { plan } from "../../scripts/migrate/reindex-hyphenated-names";
import { generateChunksLower } from "~~/shared/search";

/** A node as stored, its index cut the way it was before the hyphen parts:
 * at whitespace only, which is `generateChunksLower` less what it appends
 * after the words. */
function stored(
  id: string,
  name: string,
  type = "person",
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
  it("re-indexes a hyphenated name stored the old way", () => {
    const [one, ...rest] = plan([stored("k", "Władysław Kosiniak-Kamysz")]);
    expect(rest).toEqual([]);
    expect(one).toMatchObject({ id: "k", type: "person", hyphenated: true });
    expect(one!.chunks).toEqual(
      generateChunksLower("Władysław Kosiniak-Kamysz"),
    );
    expect(one!.chunks).toContain("kamysz");
  });

  it("re-indexes a company and a region the same way", () => {
    const rewrites = plan([
      stored("w", "Przedsiębiorstwo Wodno-Kanalizacyjne", "place"),
      stored("b", "Bielsko-Biała", "region"),
    ]);
    expect(rewrites.map((one) => one.id)).toEqual(["w", "b"]);
  });

  it("leaves alone a name the old cut already indexes right", () => {
    // No hyphen at all, and one standing between two spaces, which cuts
    // nothing: 262 hyphenated names of 2026-10-11 are like that. No bracket
    // either, which the cut of 2026-10-28 takes off a word (`searchableText`):
    // the plan is the trigger's own rule, so it re-indexes those as well.
    expect(
      plan([
        stored("a", "Anna Nowak"),
        stored("e", "Ewa Kukulska - Zając"),
        stored("p", "TOTO - SPORT", "place"),
      ]),
    ).toEqual([]);
  });

  it("takes the whitespace the trigger never redid, apart from the hyphens", () => {
    // Indexed before 2026-08-31 with the newline still on the word.
    const rewrites = plan([
      {
        id: "pec",
        data: {
          type: "place",
          name: "PEC SPÓŁKA Z OGRANICZONĄ \nODPOWIEDZIALNOŚCIĄ",
          nameChunksLower: ["", "pec", "\nodpowiedzialnością"],
        },
      },
    ]);
    expect(rewrites).toMatchObject([{ id: "pec", hyphenated: false }]);
    expect(rewrites[0]!.chunks).toContain("odpowiedzialnością");
  });

  it("indexes a searchable node that has no index at all", () => {
    expect(
      plan([{ id: "n", data: { type: "person", name: "Anna Nowak-Rudnik" } }]),
    ).toMatchObject([{ id: "n", hyphenated: true }]);
  });

  it("does not look at what search does not read, or at a node with no name", () => {
    expect(
      plan([
        stored("art", "Kosiniak-Kamysz o budżecie", "article"),
        stored("topic", "Wodno-kanalizacyjne", "topic"),
        { id: "noname", data: { type: "person" } },
        { id: "empty", data: { type: "person", name: "" } },
        { id: "odd", data: { type: "person", name: 7 } },
      ]),
    ).toEqual([]);
  });

  it("finds nothing left once its own rewrites are stored", () => {
    // What the re-run after --commit has to report.
    const nodes = [
      stored("k", "Władysław Kosiniak-Kamysz"),
      stored("w", "Przedsiębiorstwo Wodno-Kanalizacyjne", "place"),
    ];
    for (const one of plan(nodes)) {
      nodes.find((node) => node.id === one.id)!.data.nameChunksLower =
        one.chunks;
    }
    expect(plan(nodes)).toEqual([]);
  });
});

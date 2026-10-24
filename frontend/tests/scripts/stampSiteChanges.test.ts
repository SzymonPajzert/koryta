import { describe, it, expect } from "vitest";
import {
  SITE_CHANGES,
  boardCandidates,
  boardCompanies,
  stampPlan,
  type EdgeRow,
  type NodeRow,
} from "../../scripts/migrate/stamp-site-changes";

const nodes = new Map<string, NodeRow>([
  ["wodociagi", { type: "place", name: "MPWiK", published: true }],
  ["szkic", { type: "place", name: "Spółka w szkicu", published: false }],
  ["ala", { type: "person", name: "Ala", published: true }],
  ["bob", { type: "person", name: "Bob", published: false }],
  ["fil", { type: "person", name: "Fil", published: false, deleted: true }],
]);

const post = (source: string, target = "wodociagi", extra: EdgeRow = {}) => ({
  source,
  target,
  end_date: null,
  ...extra,
});

describe("boardCandidates", () => {
  it("takes the unpublished holders of posts held today at live companies", () => {
    const edges = new Map<string, EdgeRow>([
      ["e-bob", post("bob")],
      // Published holders were on the board before the change.
      ["e-ala", post("ala")],
      // An ended post, a removed one, a removed holder, an unpublished company.
      ["e-bob-old", post("bob", "wodociagi", { end_date: "2020-01-01" })],
      ["e-bob-gone", post("bob", "wodociagi", { deleted: true })],
      ["e-fil", post("fil")],
      ["e-bob-szkic", post("bob", "szkic")],
    ]);

    expect(boardCandidates(nodes, edges)).toEqual([
      { company: "wodociagi", person: "bob", edge: "e-bob" },
    ]);
  });

  it("reads an end date written as an empty string as a post held today", () => {
    const edges = new Map<string, EdgeRow>([
      ["e-bob", post("bob", "wodociagi", { end_date: "" })],
    ]);

    expect(boardCandidates(nodes, edges)).toHaveLength(1);
  });
});

describe("boardCompanies", () => {
  it("keeps a company only where both the holder and the post passed", () => {
    const candidates = [
      { company: "wodociagi", person: "bob", edge: "e-bob" },
      { company: "inna", person: "bob", edge: "e-reka" },
    ];

    expect(boardCompanies(candidates, new Set(["bob", "e-bob"]))).toEqual(
      new Set(["wodociagi"]),
    );
    expect(boardCompanies(candidates, new Set(["e-bob", "e-reka"]))).toEqual(
      new Set(),
    );
  });
});

describe("stampPlan", () => {
  it("moves only the pages dated before the change, never back", () => {
    const dated = new Map<string, NodeRow>([
      ["old", { content_changed_at: "2026-09-01T10:00:00.000Z" }],
      ["after", { content_changed_at: "2026-10-25T08:00:00.000Z" }],
      ["same", { content_changed_at: "2026-10-24T14:08:20.000Z" }],
      ["none", {}],
    ]);

    expect(
      stampPlan(
        ["old", "after", "same", "none"],
        dated,
        "2026-10-24T14:08:20Z",
      ),
    ).toEqual({ write: ["old", "none"], unchanged: 2 });
  });
});

describe("SITE_CHANGES", () => {
  it("dates every change it can, in the past, and names each once", () => {
    const ids = SITE_CHANGES.map((change) => change.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const change of SITE_CHANGES) {
      if (change.at === null) continue;
      expect(Number.isNaN(Date.parse(change.at))).toBe(false);
      expect(Date.parse(change.at)).toBeLessThan(Date.now());
    }
  });
});

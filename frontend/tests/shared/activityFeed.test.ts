import { describe, expect, it } from "vitest";
import {
  describeFeedBatch,
  feedKindGroups,
  feedKinds,
  feedVerbs,
  moreTargetsLabel,
  type FeedKind,
} from "~~/shared/activityFeed";
import { auditActions } from "~~/shared/audit";

function batch(
  kind: FeedKind,
  objects: Parameters<typeof describeFeedBatch>[0]["objects"],
  extra: { count?: number; alongEdges?: number } = {},
) {
  const distinct = Object.values(objects).reduce((sum, n) => sum + n, 0);
  return {
    kind,
    objects,
    count: extra.count ?? distinct,
    alongEdges: extra.alongEdges ?? 0,
  };
}

describe("describeFeedBatch", () => {
  it.each([
    [1, "ocenił/a 1 osobę"],
    [2, "ocenił/a 2 osoby"],
    [4, "ocenił/a 4 osoby"],
    [5, "ocenił/a 5 osób"],
    [12, "ocenił/a 12 osób"],
    [21, "ocenił/a 21 osób"],
    [22, "ocenił/a 22 osoby"],
    [112, "ocenił/a 112 osób"],
    [122, "ocenił/a 122 osoby"],
  ])("puts %i people in the right case", (n, expected) => {
    expect(describeFeedBatch(batch("vote", { person: n }))).toBe(expected);
  });

  it("lists several target types in a fixed order, with „i” before the last", () => {
    expect(
      describeFeedBatch(batch("vote", { fact: 3, person: 12, place: 1 })),
    ).toBe("ocenił/a 12 osób, 1 instytucję i 3 fakty");
    expect(describeFeedBatch(batch("vote", { fact: 2, person: 1 }))).toBe(
      "ocenił/a 1 osobę i 2 fakty",
    );
  });

  it("counts the relations published with a page after the page, not as its object", () => {
    expect(
      describeFeedBatch(batch("publish", { person: 3 }, { alongEdges: 36 })),
    ).toBe("opublikował/a 3 osoby razem z 36 powiązaniami");
    expect(
      describeFeedBatch(batch("unpublish", { person: 1 }, { alongEdges: 1 })),
    ).toBe("ukrył/a 1 osobę razem z 1 powiązaniem");
  });

  it("names relations as the object when they were published on their own", () => {
    expect(describeFeedBatch(batch("publish", { edge: 36 }))).toBe(
      "opublikował/a 36 powiązań",
    );
  });

  it("counts proposals, notes and merges rather than the pages they touched", () => {
    expect(
      describeFeedBatch(batch("proposal", { person: 1 }, { count: 3 })),
    ).toBe("zaproponował/a 3 zmiany");
    expect(
      describeFeedBatch(batch("approve", { person: 4 }, { count: 5 })),
    ).toBe("zatwierdził/a 5 propozycji");
    expect(describeFeedBatch(batch("reject", { edge: 1 }, { count: 1 }))).toBe(
      "odrzucił/a 1 propozycję",
    );
    expect(describeFeedBatch(batch("note", { person: 2 }, { count: 2 }))).toBe(
      "dodał/a 2 notatki",
    );
    expect(describeFeedBatch(batch("note", { person: 5 }, { count: 5 }))).toBe(
      "dodał/a 5 notatek",
    );
    expect(describeFeedBatch(batch("merge", { person: 1 }, { count: 2 }))).toBe(
      "scalił/a 2 duplikaty",
    );
    expect(
      describeFeedBatch(batch("import", { person: 9 }, { count: 12 })),
    ).toBe("wgrał/a automatycznie 12 zmian");
  });

  it("writes the one irregular verb out in full rather than as „/a”", () => {
    expect(describeFeedBatch(batch("delete", { person: 1 }))).toBe(
      "usunął/usunęła 1 osobę",
    );
  });

  it("says a page was only flagged for splitting, not split", () => {
    expect(describeFeedBatch(batch("splitMark", { person: 1 }))).toBe(
      "oznaczył/a 1 osobę do rozdzielenia",
    );
    expect(describeFeedBatch(batch("split", { person: 1 }))).toBe(
      "rozdzielił/a 1 osobę",
    );
  });

  it("falls back to a bare count when a batch somehow has no typed target", () => {
    expect(describeFeedBatch(batch("edit", {}, { count: 2 }))).toBe(
      "poprawił/a 2 wpisy",
    );
  });
});

describe("moreTargetsLabel", () => {
  it("agrees with any noun and any count", () => {
    expect(moreTargetsLabel(1)).toBe("i jeszcze 1");
    expect(moreTargetsLabel(3)).toBe("i jeszcze 3");
  });
});

describe("feed kinds", () => {
  it("has a verb for every kind", () => {
    for (const kind of feedKinds) expect(feedVerbs[kind]).toBeTruthy();
  });

  it("covers every audit action, so a new one cannot be dropped silently", () => {
    for (const action of auditActions) {
      expect(feedKinds).toContain(action);
    }
  });

  it("puts every kind in exactly one filter group", () => {
    const grouped = Object.values(feedKindGroups).flat();
    expect([...grouped].sort()).toEqual([...feedKinds].sort());
  });
});

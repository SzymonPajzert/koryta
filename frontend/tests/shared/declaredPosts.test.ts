import { describe, it, expect } from "vitest";
import {
  asOfDay,
  declaredEntries,
  declaredItemOf,
  foldDeclared,
  latestAsOf,
  publicDeclared,
  rewriteAppliedEdges,
  unionDeclared,
  withoutPrivateFields,
} from "../../shared/declaredPosts";
import type { DeclaredPost } from "../../shared/model";

/** One entry as the declarations automation writes it. */
function entry(fields: Partial<DeclaredPost> = {}): DeclaredPost {
  return {
    url: "https://bip.example.pl/oswiadczenie.pdf",
    as_of: "2024",
    kind: "annual",
    band: "employer",
    role: "wicestarosta",
    roleId: "wicestarosta",
    by: "readers",
    readers: 2,
    at: "2026-11-20T12:00:00.000Z",
    ...fields,
  };
}

describe("publicDeclared", () => {
  it("keeps of each entry only what a page reads", () => {
    expect(
      publicDeclared({
        "f00d-p1:employer:0": entry({
          start: "2019-11-21",
          replaces: "beef-p1:employer:0",
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
        }),
      }),
    ).toEqual({
      "f00d-p1:employer:0": {
        url: "https://bip.example.pl/oswiadczenie.pdf",
        as_of: "2024",
        kind: "annual",
        role: "wicestarosta",
        start: "2019-11-21",
      },
    });
  });

  it("keeps a kind readers did not agree on as unknown, and leaves out a start nobody gave", () => {
    expect(
      publicDeclared({ "f00d-p1:employer:0": entry({ kind: null }) }),
    ).toEqual({
      "f00d-p1:employer:0": {
        url: "https://bip.example.pl/oswiadczenie.pdf",
        as_of: "2024",
        kind: null,
        role: "wicestarosta",
      },
    });
  });

  it("gives nothing for an edge without entries", () => {
    expect(publicDeclared(undefined)).toBeUndefined();
    expect(publicDeclared({})).toBeUndefined();
    expect(publicDeclared(["not", "a", "map"])).toBeUndefined();
  });
});

describe("declaredEntries", () => {
  it("skips what is not an entry", () => {
    expect(declaredEntries({ a: entry(), b: null, c: "text" })).toEqual({
      a: entry(),
    });
  });
});

describe("withoutPrivateFields", () => {
  it("takes the entries off a stored edge and leaves the rest", () => {
    expect(
      withoutPrivateFields({
        type: "employed",
        source: "p1",
        target: "c1",
        as_of: "2024",
        declared: { "f00d-p1:employer:0": entry() },
      }),
    ).toEqual({
      type: "employed",
      source: "p1",
      target: "c1",
      as_of: "2024",
    });
  });
});

describe("latestAsOf", () => {
  it("reads a bare year as its 31 December", () => {
    expect(asOfDay("2024")).toBe("2024-12-31");
    expect(asOfDay("2024-05-15")).toBe("2024-05-15");
    // So the year is later than a day inside it, and earlier than the next.
    expect(
      latestAsOf({
        a: entry({ as_of: "2024-05-15" }),
        b: entry({ as_of: "2024" }),
      }),
    ).toBe("2024");
    expect(
      latestAsOf({
        a: entry({ as_of: "2024" }),
        b: entry({ as_of: "2025-01-02" }),
      }),
    ).toBe("2025-01-02");
  });

  it("has nothing to say of no entries", () => {
    expect(latestAsOf({})).toBeUndefined();
  });
});

describe("unionDeclared", () => {
  const first = entry({ as_of: "2023" });
  const later = entry({ as_of: "2025" });

  it("adds the entries the survivor lacks, and keeps its own as they are", () => {
    const own = entry({ as_of: "2023", role: "starosta" });
    expect(
      unionDeclared(
        { declared: { "a-p1:employer:0": own } },
        {
          declared: {
            "a-p1:employer:0": first,
            "b-p1:employer:0": later,
          },
        },
      ),
    ).toEqual({
      declared: { "a-p1:employer:0": own, "b-p1:employer:0": later },
    });
  });

  it("keeps a register edge without an as_of of its own", () => {
    // Only an edge a declaration created carries one.
    expect(
      unionDeclared({}, {
        declared: { "b-p1:employer:0": later },
        as_of: "2025",
      } as {
        declared: unknown;
      }),
    ).toEqual({ declared: { "b-p1:employer:0": later } });
  });

  it("works the survivor's as_of out again from every entry it holds", () => {
    expect(
      unionDeclared(
        { declared: { "a-p1:employer:0": first }, as_of: "2023" },
        { declared: { "b-p1:employer:0": later } },
      ),
    ).toEqual({
      declared: { "a-p1:employer:0": first, "b-p1:employer:0": later },
      as_of: "2025",
    });
  });

  it("is nothing when the copy brings no entry the survivor lacks", () => {
    expect(
      unionDeclared(
        { declared: { "a-p1:employer:0": first } },
        { declared: { "a-p1:employer:0": first } },
      ),
    ).toBeNull();
    expect(unionDeclared({}, {})).toBeNull();
  });
});

describe("foldDeclared", () => {
  it("takes in every copy that goes, and names each move", () => {
    const { union, moves } = foldDeclared(
      { id: "kept", data: { as_of: "2023", declared: { k: entry() } } },
      [
        { id: "one", data: { declared: { "a-p1:employer:0": entry() } } },
        { id: "bare", data: {} },
        {
          id: "two",
          data: { declared: { "b-p2:vii:1": entry({ as_of: "2025" }) } },
        },
      ],
    );

    expect(Object.keys(union!.declared).sort()).toEqual([
      "a-p1:employer:0",
      "b-p2:vii:1",
      "k",
    ]);
    expect(union!.as_of).toBe("2025");
    expect(moves).toEqual([
      { from: "one", to: "kept", keys: ["a-p1:employer:0"] },
      { from: "two", to: "kept", keys: ["b-p2:vii:1"] },
    ]);
  });

  it("names the move of a copy whose entries the survivor already holds", () => {
    // The reading item lists the copy, which is going, whatever is added.
    const held = { "a-p1:employer:0": entry() };
    expect(
      foldDeclared({ id: "kept", data: { declared: held } }, [
        { id: "copy", data: { declared: held } },
      ]),
    ).toEqual({
      union: null,
      moves: [{ from: "copy", to: "kept", keys: ["a-p1:employer:0"] }],
    });
  });
});

describe("rewriteAppliedEdges", () => {
  it("points a reading item's list at the edges that stay, each once", () => {
    expect(declaredItemOf("f00d-p1:employer:0")).toBe("f00d-p1");
    expect(
      rewriteAppliedEdges(
        ["copy", "other", "kept"],
        [{ from: "copy", to: "kept", keys: ["f00d-p1:employer:0"] }],
      ),
    ).toEqual(["kept", "other"]);
  });

  it("follows one copy merged into another, and stops on a loop", () => {
    expect(
      rewriteAppliedEdges(
        ["a"],
        [
          { from: "a", to: "b", keys: [] },
          { from: "b", to: "c", keys: [] },
        ],
      ),
    ).toEqual(["c"]);
    expect(
      rewriteAppliedEdges(
        ["a"],
        [
          { from: "a", to: "b", keys: [] },
          { from: "b", to: "a", keys: [] },
        ],
      ),
    ).toEqual(["b"]);
  });
});

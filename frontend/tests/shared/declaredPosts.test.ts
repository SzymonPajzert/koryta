import { describe, it, expect } from "vitest";
import {
  declaredEntries,
  publicDeclared,
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

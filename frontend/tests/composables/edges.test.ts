import { describe, it, expect } from "vitest";
import { onePerNode, type EdgeNode } from "../../app/composables/edges";
import type { EdgeType, Node } from "../../shared/model";

function edge(
  id: string,
  type: EdgeType,
  from: string,
  visibility = true,
): EdgeNode {
  return {
    id,
    type,
    source: from,
    target: "company",
    label: type,
    visibility,
    richNode: { id: from, name: from } as unknown as Node,
  };
}

const ids = (edges: EdgeNode[]) => edges.map((e) => e.id);

describe("onePerNode", () => {
  it("lists a gmina that both owns and seats the company once, as its owner", () => {
    // 131 companies in the 2026-09-27 export: the gmina they are registered in
    // also holds their shares, and „Właściciele" printed it twice.
    const rows = onePerNode(
      [edge("seat", "seat", "gmina"), edge("owns", "owns", "gmina")],
      ["owns", "seat"],
    );
    expect(ids(rows)).toEqual(["owns"]);
  });

  it("collapses a second copy of the same seat", () => {
    // 62 companies carry two seat edges from one region, written a second
    // apart in May, before edge ids were derived.
    const rows = onePerNode(
      [edge("a", "seat", "katowice"), edge("b", "seat", "katowice")],
      ["owns", "seat"],
    );
    expect(ids(rows)).toEqual(["a"]);
  });

  it("prefers the published copy, so a live relation is not drawn as a draft", () => {
    const rows = onePerNode(
      [
        edge("draft", "seat", "gliwice", false),
        edge("live", "seat", "gliwice"),
      ],
      ["owns", "seat"],
    );
    expect(ids(rows)).toEqual(["live"]);
  });

  it("puts the type ahead of publication", () => {
    // The row's remove button acts on the edge it holds. Under „Właściciele"
    // that has to be the ownership, drafted or not.
    const rows = onePerNode(
      [edge("seat", "seat", "gmina"), edge("owns", "owns", "gmina", false)],
      ["owns", "seat"],
    );
    expect(ids(rows)).toEqual(["owns"]);
  });

  it("keeps different nodes apart, in the order they first came", () => {
    const rows = onePerNode(
      [
        edge("gdansk", "owns", "gdansk"),
        edge("pkp", "owns", "pkp"),
        edge("pomorskie", "owns", "pomorskie"),
        edge("gdynia", "seat", "gdynia"),
      ],
      ["owns", "seat"],
    );
    expect(ids(rows)).toEqual(["gdansk", "pkp", "pomorskie", "gdynia"]);
  });

  it("keeps the first of equals when no preference is given", () => {
    const rows = onePerNode([
      edge("first", "owns", "gmina"),
      edge("second", "seat", "gmina"),
    ]);
    expect(ids(rows)).toEqual(["first"]);
  });
});

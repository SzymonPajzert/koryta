import { describe, it, expect } from "vitest";
import { parties, partyColors } from "../../shared/misc";

describe("parties", () => {
  /** Both were reported missing from „Przynależność partyjna": the control is
   * a `v-select` over this array, so a name absent from it cannot be typed in,
   * and a person already carrying one was stored and then invisible. */
  it("offers Nowoczesna and Bezpartyjni Samorządowcy", () => {
    expect(parties).toContain("Nowoczesna");
    expect(parties).toContain("Bezpartyjni Samorządowcy");
  });

  /** The graph legend ranks a party by `parties.indexOf`, and the first item
   * of the dropdown is what tests/e2e/tabela_suggest_changes.spec.ts clicks -
   * so a name is appended, never inserted. */
  it("keeps the parties it opened with at the front", () => {
    expect(parties.slice(0, 8)).toEqual([
      "PO",
      "PiS",
      "PSL",
      "Polska 2050",
      "Nowa Lewica",
      "SLD",
      "Konfederacja",
      "Razem",
    ]);
  });
});

describe("partyColors", () => {
  /** Two invariants at once. A colour for a name `parties` does not offer
   * paints nothing, because only a listed party can be picked, filtered on or
   * named in the graph legend; and `chart/TreemapParty.vue` pairs `parties`
   * with `Object.values(partyColors)` by index, so a fill added out of order
   * would draw one party's name on another's colour. */
  it("colours listed parties only, in the order the list has them", () => {
    expect(Object.keys(partyColors)).toEqual(
      parties.filter((party) => party in partyColors),
    );
  });
});

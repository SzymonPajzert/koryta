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
  /** A colour for a name `parties` does not offer paints nothing, because only
   * a listed party can be picked, filtered on or named in the graph legend.
   *
   * The order used to matter for a second reason - `chart/TreemapParty.vue`
   * paired `parties` with `Object.values(partyColors)` by index - and that
   * component went with the home page's party panel. Every remaining reader
   * looks a fill up by name, so this now guards tidiness rather than a bug
   * waiting to happen. Worth keeping: the next index-pairing caller would be
   * right to assume it. */
  it("colours listed parties only, in the order the list has them", () => {
    expect(Object.keys(partyColors)).toEqual(
      parties.filter((party) => party in partyColors),
    );
  });
});

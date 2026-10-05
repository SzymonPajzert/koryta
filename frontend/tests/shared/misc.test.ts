import { describe, it, expect } from "vitest";
import {
  OTHER_PARTY,
  paintedParty,
  parties,
  partyChipPaint,
  partyColors,
} from "../../shared/misc";
import { AA_TEXT, contrastRatio, readableInkOn } from "../../shared/colors";

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

  /** „Inne” is the remainder, so it is listed after every party it is the
   * remainder of - last in the dropdowns and last on the graph legend - and
   * it stays there when a party is added: the new name goes in front of it. */
  it("offers „Inne”, last", () => {
    expect(OTHER_PARTY).toBe("Inne");
    expect(parties.at(-1)).toBe(OTHER_PARTY);
    expect(parties.filter((party) => party === OTHER_PARTY)).toHaveLength(1);
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

  /** Two greys that mean different things - „Inne” is a tie to some party,
   * #898781 is „bez partii” on /eksploruj/szpitale and „pozostałe” on the
   * timeline - and both can end up in one bar. */
  it("keeps „Inne” apart from the grey that means no party", () => {
    expect(
      contrastRatio(partyColors[OTHER_PARTY]!, "#898781"),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("partyChipPaint", () => {
  it("fills a party with its colour, in the ink that reads on it", () => {
    expect(partyChipPaint("PiS")).toEqual({
      backgroundColor: partyColors.PiS,
      color: readableInkOn(partyColors.PiS!),
    });
  });

  /** Greyed out, not a grey party: a pale pill in grey ink rather than the
   * #c3c2b7 fill in black, and still readable. */
  it("greys „Inne” out", () => {
    const paint = partyChipPaint(OTHER_PARTY)!;
    expect(paint.backgroundColor).not.toBe(partyColors[OTHER_PARTY]);
    expect(paint.color).not.toBe(readableInkOn(paint.backgroundColor));
    expect(
      contrastRatio(paint.color, paint.backgroundColor),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("leaves a party with no colour to the caller", () => {
    expect(partyChipPaint("Razem")).toBeUndefined();
  });
});

describe("paintedParty", () => {
  it("is nothing for somebody with no party", () => {
    expect(paintedParty(undefined)).toBeUndefined();
    expect(paintedParty([])).toBeUndefined();
    expect(paintedParty([""])).toBeUndefined();
  });

  it("is the first party with a colour", () => {
    expect(paintedParty(["PiS", "PO"])).toBe("PiS");
    expect(paintedParty(["Razem", "PO"])).toBe("PO");
  });

  /** Parties are stored in the order they were picked, or sorted by name by
   * `ingest/person`, so „Inne” can come ahead of PiS - and a named party says
   * more than the remainder does. */
  it("passes over „Inne” for a party it names", () => {
    expect(paintedParty(["Inne", "PiS"])).toBe("PiS");
  });

  it("is „Inne” for „Inne”, and for a party the site has no colour for", () => {
    expect(paintedParty(["Inne"])).toBe(OTHER_PARTY);
    expect(paintedParty(["Razem"])).toBe(OTHER_PARTY);
  });

  it("reads parties stored as a numbered-key object", () => {
    expect(paintedParty({ "0": "Inne", "1": "PSL" })).toBe("PSL");
  });
});

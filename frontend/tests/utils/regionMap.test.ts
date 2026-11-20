import { describe, expect, it } from "vitest";
import {
  choropleth,
  choroplethLead,
  choroplethPeople,
  choroplethShare,
} from "../../app/utils/chartTheme";
import {
  ALL_PARTIES,
  leadFill,
  leadOf,
  leadStep,
  partiesByPeople,
  peopleFill,
  regionTitle,
  shareFill,
  shareOf,
  shareStep,
} from "../../app/utils/regionMap";
import { partyColors } from "../../shared/misc";

describe("leadOf", () => {
  it("names the party most people with a party have, and its share of them", () => {
    // 2 without a party are left out of the share: 6 of 8, not 6 of 10.
    expect(leadOf({ people: 10, parties: { PiS: 6, PO: 2 } })).toEqual({
      kind: "party",
      party: "PiS",
      share: 0.75,
    });
  });

  it("names nobody below three people with a party", () => {
    expect(leadOf({ people: 9, parties: { PO: 2 } })).toEqual({ kind: "thin" });
    expect(leadOf({ people: 4 })).toEqual({ kind: "thin" });
  });

  it("names nobody on a tie, or with „Inne” in front", () => {
    expect(leadOf({ people: 6, parties: { PO: 3, PiS: 3 } }).kind).toBe("tie");
    expect(leadOf({ people: 6, parties: { Inne: 4, PO: 2 } }).kind).toBe("tie");
  });

  it("tells an empty powiat from a thin one", () => {
    expect(leadOf({ people: 0 }).kind).toBe("empty");
  });
});

describe("the steps", () => {
  it("cuts the leader's share at 45% and 60%", () => {
    expect([0.44, 0.45, 0.59, 0.6, 1].map(leadStep)).toEqual([0, 1, 1, 2, 2]);
  });

  it("cuts a party's share at 20%, 40% and 60%", () => {
    expect([0.01, 0.2, 0.39, 0.4, 0.6].map(shareStep)).toEqual([0, 1, 1, 2, 3]);
  });
});

describe("leadFill", () => {
  it("shades the leading party by its share", () => {
    expect(leadFill({ people: 10, parties: { PO: 4, PiS: 3, PSL: 3 } })).toBe(
      choroplethLead.PO![0],
    );
    expect(leadFill({ people: 10, parties: { PO: 9, PiS: 1 } })).toBe(
      choroplethLead.PO![2],
    );
  });

  it("greys out what names no party", () => {
    expect(leadFill({ people: 0 })).toBe(choropleth.empty);
    expect(leadFill({ people: 2, parties: { PO: 2 } })).toBe(choropleth.thin);
    expect(leadFill({ people: 4, parties: { PO: 2, PiS: 2 } })).toBe(
      choropleth.tie,
    );
  });
});

describe("shareFill", () => {
  it("shades one party by its share of the people with a party", () => {
    const row = { people: 12, parties: { PiS: 5, PO: 5 } };
    expect(shareOf(row, "PiS")).toBe(0.5);
    expect(shareFill(row, "PiS")).toBe(choroplethShare.PiS![2]);
  });

  it("keeps a party's absence apart from too few people", () => {
    expect(shareFill({ people: 5, parties: { PO: 5 } }, "PiS")).toBe(
      choropleth.none,
    );
    expect(shareFill({ people: 5, parties: { PO: 2 } }, "PiS")).toBe(
      choropleth.thin,
    );
    expect(shareFill({ people: 0 }, "PiS")).toBe(choropleth.empty);
  });
});

describe("peopleFill", () => {
  it("colours people in six classes until party counts arrive", () => {
    expect(peopleFill(0)).toBe(choropleth.empty);
    expect([1, 4, 5, 19, 20, 99, 815].map(peopleFill)).toEqual([
      choroplethPeople[0],
      choroplethPeople[0],
      choroplethPeople[1],
      choroplethPeople[2],
      choroplethPeople[3],
      choroplethPeople[4],
      choroplethPeople[5],
    ]);
  });
});

describe("partiesByPeople", () => {
  it("orders the chips by people, „Inne” among them by its count", () => {
    const rows = [
      { people: 30, parties: { PiS: 10, PO: 8, Inne: 5 } },
      { people: 20, parties: { PO: 6, PSL: 2 } },
    ];
    expect(partiesByPeople(rows)).toEqual(["PO", "PiS", "Inne", "PSL"]);
  });

  it("leaves out a party the map cannot paint", () => {
    expect(partiesByPeople([{ people: 3, parties: { Razem: 3 } }])).toEqual([]);
  });
});

describe("regionTitle", () => {
  const row = { people: 12, parties: { PiS: 5, "Nowa Lewica": 2 } };

  it("keeps the count the e2e spec reads on the first line", () => {
    expect(regionTitle("Powiat bocheński", row, ALL_PARTIES)).toBe(
      "Powiat bocheński (12 osób)\nPiS 5, Nowa Lewica / SLD 2",
    );
  });

  it("says one party's count out of the people with a party", () => {
    expect(regionTitle("Powiat bocheński", row, "PiS")).toBe(
      "Powiat bocheński (12 osób)\nPiS: 5 z 7 osób z partią",
    );
  });

  it("says only the count where nobody has a party", () => {
    expect(regionTitle("Powiat 0204", { people: 0 }, ALL_PARTIES)).toBe(
      "Powiat 0204 (0 osób)",
    );
  });
});

describe("the ramps", () => {
  it("carry each party's own colour, so a strong powiat reads as the party", () => {
    for (const [party, ramp] of Object.entries(choroplethLead))
      expect(
        ramp.map((c) => c.toLowerCase()),
        party,
      ).toContain(partyColors[party]!.toLowerCase());
    for (const [party, ramp] of Object.entries(choroplethShare))
      expect(
        ramp.map((c) => c.toLowerCase()),
        party,
      ).toContain(partyColors[party]!.toLowerCase());
  });
});

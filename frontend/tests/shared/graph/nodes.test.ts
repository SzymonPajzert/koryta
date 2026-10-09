import { describe, it, expect } from "vitest";
import { NODE_COLORS, personNode } from "../../../shared/graph/nodes";
import { partyColors } from "../../../shared/misc";
import type { Person } from "../../../shared/model";

const person = (parties: Person["parties"]): Person =>
  ({ type: "person", name: "Jan Kowalski", parties }) as Person;

const colorOf = (parties: Person["parties"]) =>
  personNode(person(parties), partyColors).color;

describe("personNode", () => {
  it("draws somebody with no party in the person grey", () => {
    expect(colorOf([])).toBe(NODE_COLORS.person);
    expect(colorOf(undefined)).toBe(NODE_COLORS.person);
  });

  /** It was a blue, and a reader took it for PiS's or Konfederacja's navy. A
   * grey reads as a party of none, and leaves every hue to the parties. */
  it("draws nobody's party in a colour that could pass for one", () => {
    const [r, g, b] = [1, 3, 5].map((at) =>
      parseInt(NODE_COLORS.person.slice(at, at + 2), 16),
    ) as [number, number, number];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(16);
    expect(Object.values(partyColors)).not.toContain(NODE_COLORS.person);
  });

  it("draws a party in its own colour", () => {
    expect(colorOf(["PiS"])).toBe(partyColors.PiS);
  });

  /** A dot's colour is all a reader has to go on, and „Inne” can be stored
   * ahead of PiS - so the party that is named wins. */
  it("draws „Inne” grey, and a named party over it", () => {
    expect(colorOf(["Inne"])).toBe(partyColors.Inne);
    expect(colorOf(["Inne", "PiS"])).toBe(partyColors.PiS);
  });

  /** The darker grey is no party at all; a party the site has no colour for
   * is a tie to somebody, which is what „Inne” stands for. */
  it("draws a party with no colour of its own as „Inne”", () => {
    expect(colorOf(["Razem"])).toBe(partyColors.Inne);
  });
});

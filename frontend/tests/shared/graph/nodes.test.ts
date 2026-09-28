import { describe, it, expect } from "vitest";
import { NODE_COLORS, personNode } from "../../../shared/graph/nodes";
import { partyColors } from "../../../shared/misc";
import type { Person } from "../../../shared/model";

const person = (parties: Person["parties"]): Person =>
  ({ type: "person", name: "Jan Kowalski", parties }) as Person;

const colorOf = (parties: Person["parties"]) =>
  personNode(person(parties), partyColors).color;

describe("personNode", () => {
  it("draws somebody with no party in the person blue", () => {
    expect(colorOf([])).toBe(NODE_COLORS.person);
    expect(colorOf(undefined)).toBe(NODE_COLORS.person);
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

  /** Blue is no party at all; a party the site has no colour for is a tie to
   * somebody, which is what „Inne” stands for. */
  it("draws a party with no colour of its own as „Inne”", () => {
    expect(colorOf(["Razem"])).toBe(partyColors.Inne);
  });
});

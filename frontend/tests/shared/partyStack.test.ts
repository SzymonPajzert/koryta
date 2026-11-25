import { describe, it, expect } from "vitest";
import type { HeldPost } from "../../shared/homeTimeline";
import { buildPartyStack, partyBands } from "../../shared/partyStack";

const TODAY = "2026-11-25";

/** A post held from January 2026 on, in the bands its person's parties give. */
const post = (personId: string, parties: string[]): HeldPost => ({
  personId,
  groups: partyBands(parties),
  start: "2026-01-10",
  end: null,
});

/** Each month's bands summed: what the top edge of the stack draws. */
function tops(stack: ReturnType<typeof buildPartyStack>): number[] {
  return stack.months.map((_, i) =>
    stack.series.reduce((sum, band) => sum + band.counts[i]!, 0),
  );
}

const at = (stack: ReturnType<typeof buildPartyStack>, key: string) =>
  stack.series.find((band) => band.key === key)?.counts.at(-1);

describe("partyBands", () => {
  it("takes every named party, so the person can be shared out", () => {
    expect(partyBands(["PSL", "Polska 2050"])).toEqual(["PSL", "Polska 2050"]);
  });

  it("lets a named party outrank „Inne”", () => {
    // „Inne” says there is a tie but not whose.
    expect(partyBands(["Inne", "PiS"])).toEqual(["PiS"]);
  });

  it("keeps „Inne” for a person who has nothing else", () => {
    expect(partyBands(["Inne"])).toEqual(["Inne"]);
  });

  it("counts SLD and Nowa Lewica as one party", () => {
    expect(partyBands(["SLD", "Nowa Lewica"])).toEqual(["Nowa Lewica"]);
  });

  it("leaves out a party the site has no colour for, and a person with none", () => {
    expect(partyBands(["Razem", "PO"])).toEqual(["PO"]);
    expect(partyBands(["Razem"])).toEqual([]);
    expect(partyBands([])).toEqual([]);
  });
});

describe("buildPartyStack", () => {
  it("shares a person with two parties evenly, so the bands add up to the people", () => {
    const stack = buildPartyStack(
      [
        post("a", ["PSL", "Polska 2050"]),
        post("b", ["PSL"]),
        post("c", ["PO"]),
        post("d", ["PiS"]),
      ],
      TODAY,
    );

    expect(at(stack, "PSL")).toBe(1.5);
    expect(at(stack, "Polska 2050")).toBe(0.5);
    expect(tops(stack).every((top) => top === 4)).toBe(true);
  });

  it("counts a person once in all, however many posts they hold", () => {
    const stack = buildPartyStack(
      [
        post("a", ["PO", "PiS"]),
        { ...post("a", ["PO", "PiS"]), start: "2026-03-01" },
      ],
      TODAY,
    );

    expect(tops(stack).at(-1)).toBe(1);
  });

  it("stacks the parties in the site's order, „Inne partie” on top", () => {
    const stack = buildPartyStack(
      [
        post("a", ["Inne"]),
        post("b", ["PiS"]),
        post("c", ["PiS"]),
        post("d", ["PO"]),
        post("e", ["PSL"]),
      ],
      TODAY,
    );

    expect(stack.series.map((band) => band.key)).toEqual([
      "PO",
      "PiS",
      "PSL",
      "Inne",
    ]);
    expect(stack.series.at(-1)?.label).toBe("Inne partie");
  });

  it("folds a band too thin to see into „Inne partie”", () => {
    // One person of a hundred never reaches 2% of the tallest month.
    const stack = buildPartyStack(
      [
        ...Array.from({ length: 99 }, (_, i) => post(`p${i}`, ["PiS"])),
        post("k", ["Konfederacja"]),
      ],
      TODAY,
    );

    expect(stack.series.map((band) => band.key)).toEqual(["PiS", "Inne"]);
    expect(at(stack, "Inne")).toBe(1);
  });

  it("keeps the tallest bands when there are more than it may draw", () => {
    const parties = ["PO", "PiS", "PSL", "Polska 2050"];
    const stack = buildPartyStack(
      parties.flatMap((party, rank) =>
        Array.from({ length: 10 - rank }, (_, i) =>
          post(`${party}${i}`, [party]),
        ),
      ),
      TODAY,
      { maxBands: 3 },
    );

    // Two parties and the folded remainder: PSL (8) and Polska 2050 (7).
    expect(stack.series.map((band) => band.key)).toEqual(["PO", "PiS", "Inne"]);
    expect(at(stack, "Inne")).toBe(15);
  });

  it("draws nothing for no posts", () => {
    expect(buildPartyStack([], TODAY)).toEqual({ months: [], series: [] });
  });
});

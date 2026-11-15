import { describe, it, expect } from "vitest";
import {
  declarationPeopleSchema,
  peopleGroups,
  type DeclarationPeople,
} from "../../shared/declarations";
import { SEEDED_DECLARATION_PEOPLE as seeded } from "../../scripts/declarationPeople";

/** A night's count, small: every stage present once over. */
const snapshot = (over: Partial<DeclarationPeople> = {}) => ({
  at: "2026-11-14T06:30:00.000Z",
  exportDay: "2026-11-14",
  people: 36,
  published: 8,
  namesakes: 1,
  mismatched: 2,
  held: 3,
  reading: 4,
  cropped: 5,
  downloaded: 6,
  searching: 7,
  searchingBy: [{ reason: "unreachable", count: 7 }],
  expectedNamesakes: { count: 3, low: 2, high: 4 },
  bySurname: [{ min: 0, max: 50, settled: 9, namesakes: 1, remaining: 20 }],
  topUnits: [
    {
      teryt: "106101",
      name: "Przykładowo (gmina miejska)",
      people: 7,
      reason: "unreachable",
    },
  ],
  publishedByDay: [{ day: "2026-11-13", count: 8 }],
  ...over,
});

describe("declarationPeopleSchema", () => {
  it("reads a night's count", () => {
    expect(declarationPeopleSchema.safeParse(snapshot()).success).toBe(true);
  });

  it("refuses stages that do not add up to the people counted", () => {
    // Every person is in exactly one stage: a count that loses somebody, or
    // counts them twice, would draw a line that lies.
    const result = declarationPeopleSchema.safeParse(snapshot({ people: 37 }));
    expect(result.success).toBe(false);
  });

  it("refuses a reason the site has no words for", () => {
    const result = declarationPeopleSchema.safeParse(
      snapshot({
        searchingBy: [{ reason: "gone" as "unreachable", count: 7 }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("takes no estimate before enough have settled", () => {
    expect(
      declarationPeopleSchema.safeParse(snapshot({ expectedNamesakes: null }))
        .success,
    ).toBe(true);
  });

  it("reads the snapshot the emulator is seeded with", () => {
    // The seed is what every local stack and test run draws from: a shape the
    // site refuses would leave the panel and the page empty there.
    expect(declarationPeopleSchema.safeParse(seeded).success).toBe(true);
  });
});

describe("peopleGroups", () => {
  it("counts the namesakes apart, outside the total", () => {
    const groups = peopleGroups(snapshot() as DeclarationPeople);
    expect(groups.total).toBe(35);
    expect(groups.namesakes).toBe(1);
    expect(groups.published + groups.underway + groups.searching).toBe(
      groups.total,
    );
  });

  it("puts everything with a declaration in hand and no publication under way", () => {
    // Held, mismatched, with readers, cropped and downloaded: 2+3+4+5+6.
    expect(peopleGroups(snapshot() as DeclarationPeople).underway).toBe(20);
  });
});

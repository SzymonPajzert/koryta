import { describe, expect, it } from "vitest";
import {
  combineProgressCounts,
  scanProgress,
  type ProgressCounts,
} from "~~/server/utils/progressStats";

/** A person as `/api/stats/progress` projects one out of Firestore.
 *
 * `undefined` rather than `false` is a case of its own throughout: a person no
 * revision has written since the trigger started maintaining `stats.isApproved`
 * carries no such field, which is why the counted path never asks Firestore for
 * `== false`. Every fixture below that leaves a field out is testing that. */
function person(stats: {
  isApproved?: boolean;
  humanVoted?: boolean;
  notesCount?: number;
}) {
  return {
    stats: {
      ...(stats.isApproved === undefined
        ? {}
        : { isApproved: stats.isApproved }),
      ...(stats.humanVoted === undefined
        ? {}
        : { votes: { humanVoted: stats.humanVoted } }),
      ...(stats.notesCount === undefined
        ? {}
        : { notesCount: stats.notesCount }),
    },
  };
}

/** What Firestore's aggregations would answer for a given population, so that
 * the two implementations can be compared on the same data. Mirrors the
 * queries in `countProgress`, predicate for predicate. */
function countsFor(people: ReturnType<typeof person>[]): ProgressCounts {
  const approved = (p: (typeof people)[number]) => p.stats.isApproved === true;
  const voted = (p: (typeof people)[number]) =>
    p.stats.votes?.humanVoted === true;
  const noted = (p: (typeof people)[number]) => (p.stats.notesCount ?? 0) > 0;

  return {
    total: people.length,
    approved: people.filter(approved).length,
    voted: people.filter(voted).length,
    votedAndApproved: people.filter((p) => voted(p) && approved(p)).length,
    noted: people
      .filter(noted)
      .map((p) => ({ isApproved: approved(p), humanVoted: voted(p) })),
  };
}

describe("scanProgress", () => {
  it("splits every person into exactly one of approved, reviewed and toCheck", () => {
    const stats = scanProgress([
      person({ isApproved: true }),
      person({ humanVoted: true }),
      person({ notesCount: 2 }),
      person({}),
    ]);

    expect(stats).toEqual({
      total: 4,
      approved: 1,
      reviewed: 2,
      toCheck: 1,
      withVotes: 1,
      withNotes: 1,
    });
  });

  it("counts a person with both a vote and a note as reviewed once", () => {
    const stats = scanProgress([person({ humanVoted: true, notesCount: 1 })]);

    expect(stats.reviewed).toBe(1);
    expect(stats.withVotes).toBe(1);
    expect(stats.withNotes).toBe(1);
  });

  it("treats an approved person as approved however much attention they had", () => {
    const stats = scanProgress([
      person({ isApproved: true, humanVoted: true, notesCount: 3 }),
    ]);

    expect(stats).toMatchObject({ approved: 1, reviewed: 0, toCheck: 0 });
    // Still counted in the two "has any" totals, which cut across the split.
    expect(stats).toMatchObject({ withVotes: 1, withNotes: 1 });
  });

  it("does not count a notesCount of zero as a note", () => {
    expect(scanProgress([person({ notesCount: 0 })])).toMatchObject({
      withNotes: 0,
      toCheck: 1,
    });
  });
});

describe("combineProgressCounts", () => {
  // The whole point of the aggregation path: it must be indistinguishable from
  // reading every document. Each population below is a shape that broke, or
  // could break, one of the two.
  const populations: Record<string, ReturnType<typeof person>[]> = {
    empty: [],
    "nobody touched": [person({}), person({}), person({})],
    "everyone approved": [
      person({ isApproved: true }),
      person({ isApproved: true, humanVoted: true }),
    ],
    "votes and notes overlapping": [
      person({ humanVoted: true }),
      person({ notesCount: 1 }),
      person({ humanVoted: true, notesCount: 4 }),
      person({}),
    ],
    "approved people carrying votes and notes": [
      person({ isApproved: true, humanVoted: true, notesCount: 1 }),
      person({ isApproved: true, notesCount: 2 }),
      person({ humanVoted: true, notesCount: 1 }),
      person({ humanVoted: true }),
      person({}),
    ],
    "fields absent rather than false": [
      person({}),
      person({ isApproved: false }),
      person({ humanVoted: false }),
      person({ notesCount: 0 }),
      person({ isApproved: false, humanVoted: false, notesCount: 0 }),
    ],
  };

  for (const [name, people] of Object.entries(populations)) {
    it(`agrees with the scan: ${name}`, () => {
      expect(combineProgressCounts(countsFor(people))).toEqual(
        scanProgress(people),
      );
    });
  }

  it("agrees with the scan on a randomised population", () => {
    // Seeded by hand rather than by Math.random, so a failure is reproducible.
    let seed = 20260910;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let run = 0; run < 50; run++) {
      const people = Array.from({ length: 40 }, () =>
        person({
          isApproved: next() < 0.4 ? next() < 0.8 : undefined,
          humanVoted: next() < 0.5 ? next() < 0.6 : undefined,
          notesCount: next() < 0.3 ? Math.floor(next() * 3) : undefined,
        }),
      );

      expect(combineProgressCounts(countsFor(people))).toEqual(
        scanProgress(people),
      );
    }
  });
});

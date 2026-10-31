import { describe, it, expect } from "vitest";
import { foldAutomaticPublications } from "../../app/utils/activityAutomatic";

const counts = (publication: number) => ({
  vote: 2,
  revision: 3,
  noteSource: 1,
  publication,
});

describe("foldAutomaticPublications", () => {
  it("counts the automation's publications in „Opublikowane osoby”, per day and in all", () => {
    const folded = foldAutomaticPublications({
      totals: counts(4),
      total: 10,
      automatic: 7,
      daily: [
        { date: "2026-10-30", counts: counts(1), total: 7, automatic: 5 },
        { date: "2026-10-31", counts: counts(3), total: 9, automatic: 2 },
      ],
    });

    expect(folded.totals).toEqual(counts(11));
    expect(folded.total).toBe(17);
    expect(folded.daily.map((day) => day.counts.publication)).toEqual([6, 5]);
    expect(folded.daily.map((day) => day.total)).toEqual([12, 11]);
  });

  it("reads a response without the field as no automatic publications", () => {
    // What a server older than the field answers with.
    const folded = foldAutomaticPublications({
      totals: counts(4),
      total: 10,
      daily: [{ date: "2026-10-31", counts: counts(4), total: 10 }],
    });

    expect(folded.total).toBe(10);
    expect(folded.daily[0]!.total).toBe(10);
  });
});

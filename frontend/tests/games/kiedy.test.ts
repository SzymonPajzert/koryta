import { describe, it, expect } from "vitest";
import {
  kiedyIsAskable,
  kiedyPoints,
  kiedySquare,
  kiedyVerdict,
  pickKiedySwaps,
  type KiedySwap,
} from "../../shared/games/kiedy";

function swap(id: string, answer = 2015): KiedySwap {
  return {
    id,
    companyName: "Spółka",
    role: "Zarząd",
    gapDays: 0,
    batchSize: 1,
    left: { name: "Adam Lewy", parties: [] },
    joined: { name: "Barbara Prawa", parties: [] },
    answer,
  };
}

describe("kiedyPoints", () => {
  it("gives full marks for the year and nothing five years out", () => {
    expect(kiedyPoints(2015, 2015)).toBe(100);
    expect(kiedyPoints(2016, 2015)).toBe(80);
    expect(kiedyPoints(2010, 2015)).toBe(0);
  });

  it("never goes negative, however wild the guess", () => {
    expect(kiedyPoints(2000, 2026)).toBe(0);
  });

  it("is symmetric — guessing early and late cost the same", () => {
    expect(kiedyPoints(2013, 2015)).toBe(kiedyPoints(2017, 2015));
  });
});

describe("kiedySquare", () => {
  it("buckets by distance", () => {
    expect(kiedySquare(2015, 2015)).toBe("🟩");
    expect(kiedySquare(2016, 2015)).toBe("🟨");
    expect(kiedySquare(2018, 2015)).toBe("🟧");
    expect(kiedySquare(2001, 2015)).toBe("⬜");
  });
});

describe("kiedyVerdict", () => {
  it("says which way the player was wrong", () => {
    expect(kiedyVerdict(2015, 2015)).toBe("Dokładnie!");
    expect(kiedyVerdict(2013, 2015)).toContain("za wcześnie");
    expect(kiedyVerdict(2017, 2015)).toContain("za późno");
  });

  it("declines the year properly for one", () => {
    expect(kiedyVerdict(2014, 2015)).toBe("O 1 rok za wcześnie.");
  });
});

describe("pickKiedySwaps", () => {
  const pool = Array.from({ length: 40 }, (_, i) => swap(`s${i}`));

  it("gives the same six for the same day", () => {
    const a = pickKiedySwaps("2026-09-02", pool).map((s) => s.id);
    const b = pickKiedySwaps("2026-09-02", pool).map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);
  });

  it("gives a different day a different set", () => {
    const a = pickKiedySwaps("2026-09-02", pool).map((s) => s.id);
    const b = pickKiedySwaps("2026-09-03", pool).map((s) => s.id);
    expect(a).not.toEqual(b);
  });

  it("never asks the same handover twice in one day", () => {
    const drawn = pickKiedySwaps("2026-09-02", pool);
    expect(new Set(drawn.map((s) => s.id)).size).toBe(drawn.length);
  });
});

describe("kiedyIsAskable", () => {
  it("rejects a handover the register only half supports", () => {
    expect(kiedyIsAskable({ ...swap("a"), role: "  " }, 2026)).toBe(false);
    expect(
      kiedyIsAskable({ ...swap("a"), left: { name: "", parties: [] } }, 2026),
    ).toBe(false);
  });

  it("rejects years outside the slider, rather than squeezing them onto it", () => {
    expect(kiedyIsAskable(swap("a", 1994), 2026)).toBe(false);
    expect(kiedyIsAskable(swap("a", 2027), 2026)).toBe(false);
    expect(kiedyIsAskable(swap("a", 2015), 2026)).toBe(true);
  });
});

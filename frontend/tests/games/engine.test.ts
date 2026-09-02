import { describe, it, expect } from "vitest";
import {
  dailyRandom,
  pickDaily,
  puzzleNumber,
  warsawDay,
} from "../../shared/games/engine";

describe("dailyRandom", () => {
  it("is stable for one game and day", () => {
    const a = dailyRandom("kiedy", "2026-09-02");
    const b = dailyRandom("kiedy", "2026-09-02");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("differs between games on the same day, so two dailies drawing from one pool do not draw the same thing", () => {
    const kiedy = dailyRandom("kiedy", "2026-09-02");
    const studia = dailyRandom("studia", "2026-09-02");
    expect(kiedy()).not.toEqual(studia());
  });
});

describe("puzzleNumber", () => {
  it("counts the first day as 1", () => {
    expect(puzzleNumber("2026-09-02", "2026-09-02")).toBe(1);
    expect(puzzleNumber("2026-09-02", "2026-09-03")).toBe(2);
  });

  it("survives a daylight saving change", () => {
    // Poland moves the clock on the last Sunday of October.
    expect(puzzleNumber("2026-10-24", "2026-10-26")).toBe(3);
  });
});

describe("warsawDay", () => {
  it("uses Warsaw midnight, not UTC", () => {
    // 22:30 UTC in summer is already the next day in Warsaw (UTC+2).
    expect(warsawDay(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  });
});

describe("pickDaily", () => {
  const pool = ["d", "b", "a", "c", "e"];
  const key = (item: string) => item;

  it("does not depend on the order the pool arrived in", () => {
    const first = pickDaily(pool, key, dailyRandom("g", "2026-09-02"), 3);
    const shuffled = ["e", "a", "c", "d", "b"];
    const second = pickDaily(shuffled, key, dailyRandom("g", "2026-09-02"), 3);
    expect(first).toEqual(second);
  });

  it("never repeats an item within one draw", () => {
    const drawn = pickDaily(pool, key, dailyRandom("g", "2026-09-02"), 5);
    expect(new Set(drawn).size).toBe(5);
  });

  it("returns everything it has when the pool is short", () => {
    expect(pickDaily(["a"], key, dailyRandom("g", "x"), 6)).toHaveLength(1);
  });
});

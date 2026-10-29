import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rowMatches, type RowEmployment } from "~/utils/rowMatches";

const job = (
  placeId: string,
  name: string,
  end_date?: string,
): RowEmployment => ({
  placeId,
  name,
  edge: { type: "employed", end_date },
});

const options = { matchedPlaces: {}, currentOnly: false };

describe("rowMatches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks nothing at all where the page sets no such filter", () => {
    expect(rowMatches([job("mesko", "MESKO")], undefined, options)).toEqual({});
  });

  it("marks the employers the company filters let through", () => {
    const row = rowMatches(
      [job("mesko", "MESKO"), job("mpk", "MPK KIELCE")],
      new Set(["mesko"]),
      options,
    );
    expect(row).toEqual({
      matchedCompanies: ["MESKO"],
      seatedInMatchedRegion: [],
      matchedThrough: [],
    });
  });

  it("says an empty list, not nothing, when none of them matched", () => {
    const row = rowMatches([job("mpk", "MPK KIELCE")], new Set(), options);
    expect(row.matchedCompanies).toEqual([]);
  });

  it("marks an employer seated in a region the region filter matched", () => {
    const row = rowMatches(
      [job("mpk", "MPK KRAKÓW"), job("mesko", "MESKO")],
      new Set(["teryt1261"]),
      { ...options, seats: { mpk: { id: "teryt1261", name: "Kraków" } } },
    );
    expect(row.seatedInMatchedRegion).toEqual(["MPK KRAKÓW"]);
    expect(row.matchedCompanies).toEqual([]);
  });

  it("takes only a post held now through a seat, under `selected`", () => {
    const seats = {
      old: { id: "teryt1261", name: "Kraków" },
      now: { id: "teryt1261", name: "Kraków" },
    };
    const row = rowMatches(
      [job("old", "ODEJŚCIE", "2024-09-06"), job("now", "OBECNA")],
      new Set(["teryt1261"]),
      { ...options, seats, currentOnly: true },
    );
    expect(row.seatedInMatchedRegion).toEqual(["OBECNA"]);
  });

  it("names the companies above an employer when no employer matched", () => {
    const row = rowMatches(
      [job("rr", "RR SECURITY (Warszawa)")],
      new Set(["tauron", "teryt12"]),
      {
        ...options,
        matchedPlaces: { tauron: "TAURON POLSKA ENERGIA (Katowice)" },
      },
    );
    expect(row.matchedThrough).toEqual(["TAURON POLSKA ENERGIA (Katowice)"]);
  });

  it("names none of them once an employer of their own matched", () => {
    const row = rowMatches(
      [job("mesko", "MESKO"), job("telesystem", "TELESYSTEM-MESKO")],
      new Set(["mesko", "pgz"]),
      { ...options, matchedPlaces: { mesko: "MESKO", pgz: "PGZ" } },
    );
    expect(row.matchedCompanies).toEqual(["MESKO"]);
    expect(row.matchedThrough).toEqual([]);
  });
});

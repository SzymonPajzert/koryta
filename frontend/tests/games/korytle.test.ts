import { describe, it, expect } from "vitest";
import {
  bearingDeg,
  branzaFromCompany,
  directionArrow,
  haversineKm,
  korytlePuzzleNumber,
  pickKorytleAnswer,
  powiatCentroids,
  proximityPercent,
  proximitySquares,
  terytToPowiat,
} from "../../shared/games/korytle";

const krakow = { lat: 50.06, lng: 19.94 };
const warszawa = { lat: 52.23, lng: 21.01 };
const gdansk = { lat: 54.35, lng: 18.65 };

describe("terytToPowiat", () => {
  it("normalizes codes of different levels", () => {
    expect(terytToPowiat("1261")).toBe("1261");
    expect(terytToPowiat("teryt1261")).toBe("1261");
    expect(terytToPowiat("413")).toBe("0413");
    // 6-digit gmina code with the leading zero stripped.
    expect(terytToPowiat("201011")).toBe("0201");
    expect(terytToPowiat("1261011")).toBe("1261");
  });

  it("rejects voivodeships and invalid codes", () => {
    expect(terytToPowiat("12")).toBeNull();
    expect(terytToPowiat("")).toBeNull();
    expect(terytToPowiat("12345678")).toBeNull();
  });
});

describe("geometry", () => {
  it("computes plausible distances", () => {
    const km = haversineKm(krakow, warszawa);
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(270);
    expect(haversineKm(krakow, krakow)).toBe(0);
  });

  it("points arrows in the right direction", () => {
    expect(directionArrow(0)).toBe("⬆️");
    expect(directionArrow(350)).toBe("⬆️");
    expect(directionArrow(45)).toBe("↗️");
    expect(directionArrow(180)).toBe("⬇️");
    expect(directionArrow(270)).toBe("⬅️");
    // Gdańsk (and, at 8-way precision, Warszawa too) is north of Kraków.
    expect(directionArrow(bearingDeg(krakow, gdansk))).toBe("⬆️");
    expect(directionArrow(bearingDeg(krakow, warszawa))).toBe("⬆️");
    // Białystok is clearly north-east of Kraków.
    expect(directionArrow(bearingDeg(krakow, { lat: 53.13, lng: 23.16 }))).toBe(
      "↗️",
    );
  });

  it("scores proximity like Worldle", () => {
    expect(proximityPercent(0)).toBe(100);
    expect(proximityPercent(10000)).toBe(0);
    expect(proximitySquares(100)).toBe("🟩🟩🟩🟩🟩");
    expect(proximitySquares(56)).toBe("🟩🟩🟨⬜⬜");
    expect(proximitySquares(0)).toBe("⬜⬜⬜⬜⬜");
  });
});

describe("powiatCentroids", () => {
  it("projects western powiats to smaller longitudes", () => {
    const centroids = powiatCentroids([
      { teryt: "0261", d: "M 0 0 L 0 10 L 10 10 L 10 0 Z" },
      { teryt: "1261", d: "M 90 90 L 90 100 L 100 100 L 100 90 Z" },
    ]);
    const west = centroids.get("0261")!;
    const east = centroids.get("1261")!;
    expect(west.lng).toBeLessThan(east.lng);
    // Smaller SVG y means further north.
    expect(west.lat).toBeGreaterThan(east.lat);
  });
});

describe("branzaFromCompany", () => {
  it("prefers the primary PKD code, then explicit categories", () => {
    expect(branzaFromCompany(undefined, ["szpitale"])).toBe("zdrowie i opieka");
    expect(branzaFromCompany(["49.31.Z"], ["wodociagi"])).toBe(
      "transport i logistyka",
    );
    expect(branzaFromCompany(["86.10.Z"])).toBe("zdrowie i opieka");
    expect(branzaFromCompany(["35.11.Z"])).toBe("energetyka");
    expect(branzaFromCompany(["99.99.Z"], ["wodociagi"])).toBe("woda i odpady");
    expect(branzaFromCompany([])).toBe("inne");
    expect(branzaFromCompany()).toBe("inne");
  });

  it("accepts Firestore map-shaped fields", () => {
    expect(branzaFromCompany({ 0: "35.11.Z" })).toBe("energetyka");
    expect(branzaFromCompany(undefined, { 0: "szpitale" })).toBe(
      "zdrowie i opieka",
    );
  });
});

describe("pickKorytleAnswer", () => {
  it("is deterministic and order-independent", () => {
    const ids = ["c", "a", "b", "d"];
    const first = pickKorytleAnswer("2026-07-27", ids);
    expect(first).not.toBeNull();
    expect(pickKorytleAnswer("2026-07-27", [...ids].reverse())).toBe(first);
    expect(pickKorytleAnswer("2026-07-27", ids)).toBe(first);
  });

  it("handles empty input", () => {
    expect(pickKorytleAnswer("2026-07-27", [])).toBeNull();
  });
});

describe("korytlePuzzleNumber", () => {
  it("counts days since the first puzzle", () => {
    expect(korytlePuzzleNumber("2026-07-27")).toBe(1);
    expect(korytlePuzzleNumber("2026-08-03")).toBe(8);
  });
});

/** Daily "Korytle" puzzle: guess which region of Poland a mosaic of
 * koryciarze (grouped by company branża, then party) belongs to.
 *
 * After each guess the player learns the distance, direction and a Worldle
 * style proximity score. This module is pure — Firestore access lives in
 * server/api/games/korytle.get.ts.
 */

import { hashSeed, mulberry32 } from "./connections";
import { toStringArray } from "./util";

export interface KorytleOption {
  /** Region node id. */
  id: string;
  name: string;
  teryt: string;
  lat: number;
  lng: number;
}

export interface KorytleCell {
  branza: string;
  party: string;
  count: number;
}

export interface KorytlePersonReveal {
  id: string;
  name: string;
  party?: string;
  branza: string;
  company: string;
}

export interface KorytlePuzzle {
  date: string;
  number: number;
  answer: KorytleOption;
  cells: KorytleCell[];
  totalPeople: number;
  /** Shown only after the game ends. */
  people: KorytlePersonReveal[];
  /** Regions the player can guess. */
  options: KorytleOption[];
}

export const korytleMaxGuesses = 6;

/** Date of puzzle #1. */
export const korytleFirstDay = "2026-07-27";

export function korytlePuzzleNumber(date: string): number {
  const days =
    (Date.parse(date) - Date.parse(korytleFirstDay)) / (24 * 3600 * 1000);
  return Math.round(days) + 1;
}

/** Roughly Poland corner to corner; caps the proximity score at 0%. */
export const korytleMaxDistanceKm = 770;

export const korytleNoParty = "bez partii";

/** Normalizes a TERYT code to the 4-digit powiat it belongs to.
 * Returns null for voivodeship-level (or invalid) codes. */
export function terytToPowiat(teryt: string): string | null {
  const digits = teryt.replace(/\D/g, "");
  if (digits.length <= 2 || digits.length > 7) return null;
  if (digits.length <= 4) return digits.padStart(4, "0");
  return digits.padStart(7, "0").slice(0, 4);
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Initial bearing from `a` to `b` in degrees, 0 = north, clockwise. */
export function bearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const directionArrows = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];

export function directionArrow(bearing: number): string {
  return directionArrows[Math.round(bearing / 45) % 8]!;
}

export function proximityPercent(distanceKm: number): number {
  const ratio = Math.min(distanceKm / korytleMaxDistanceKm, 1);
  return Math.round(100 * (1 - ratio));
}

export function proximitySquares(percent: number): string {
  const green = Math.floor(percent / 20);
  const yellow = percent % 20 >= 10 && green < 5 ? 1 : 0;
  return (
    "🟩".repeat(green) + "🟨".repeat(yellow) + "⬜".repeat(5 - green - yellow)
  );
}

/** Deterministic daily pick from the eligible region ids (sorted first, so
 * the result does not depend on input order). */
export function pickKorytleAnswer(
  date: string,
  eligibleIds: string[],
): string | null {
  if (eligibleIds.length === 0) return null;
  const sorted = [...eligibleIds].sort();
  const rand = mulberry32(hashSeed(`korytle:${date}`));
  return sorted[Math.floor(rand() * sorted.length)]!;
}

// --- powiat centroids from the SVG map in app/assets/poland_powiaty.json ---

export interface PowiatPath {
  teryt: string;
  d: string;
}

/** Geographic bounding box of Poland, used for a linear fit of the SVG map.
 * The projection error is irrelevant at game precision. */
const polandBounds = {
  latMin: 49.0,
  latMax: 54.84,
  lngMin: 14.12,
  lngMax: 24.15,
};

function pathPoints(d: string): [number, number][] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([Number(numbers[i]), Number(numbers[i + 1])]);
  }
  return points;
}

/** Approximate lat/lng centroid per powiat (keyed by 4-digit TERYT). */
export function powiatCentroids(
  paths: PowiatPath[],
): Map<string, { lat: number; lng: number }> {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const centers = new Map<string, { x: number; y: number }>();

  for (const path of paths) {
    const points = pathPoints(path.d);
    if (points.length === 0) continue;
    let xSum = 0;
    let ySum = 0;
    for (const [x, y] of points) {
      xSum += x;
      ySum += y;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    centers.set(path.teryt.padStart(4, "0"), {
      x: xSum / points.length,
      y: ySum / points.length,
    });
  }

  const result = new Map<string, { lat: number; lng: number }>();
  for (const [teryt, { x, y }] of centers) {
    result.set(teryt, {
      // SVG y grows southwards, latitude grows northwards.
      lat:
        polandBounds.latMax -
        ((y - yMin) / (yMax - yMin)) *
          (polandBounds.latMax - polandBounds.latMin),
      lng:
        polandBounds.lngMin +
        ((x - xMin) / (xMax - xMin)) *
          (polandBounds.lngMax - polandBounds.lngMin),
    });
  }
  return result;
}

// --- branża from PKD activity codes ---

const pkdDivisionBranzas: [start: number, end: number, branza: string][] = [
  [1, 3, "rolnictwo i leśnictwo"],
  [5, 9, "górnictwo"],
  [10, 33, "przemysł"],
  [35, 35, "energetyka"],
  [36, 39, "woda i odpady"],
  [41, 43, "budownictwo"],
  [45, 47, "handel"],
  [49, 53, "transport i logistyka"],
  [55, 56, "hotele i gastronomia"],
  [58, 63, "media i IT"],
  [64, 66, "finanse"],
  [68, 68, "nieruchomości"],
  [69, 75, "usługi profesjonalne"],
  [77, 82, "usługi administracyjne"],
  [84, 84, "administracja publiczna"],
  [85, 85, "edukacja"],
  [86, 88, "zdrowie i opieka"],
  [90, 93, "kultura i sport"],
];

export const korytleOtherBranza = "inne";

/** Coarse branża label for a company, from its primary (first) PKD code,
 * with the KRS-derived categories as a fallback. Takes `unknown` because
 * stored nodes do not always match the TS types. */
export function branzaFromCompany(
  activity?: unknown,
  categories?: unknown,
): string {
  const primary = toStringArray(activity)[0];
  if (primary) {
    const division = Number.parseInt(primary, 10);
    for (const [start, end, branza] of pkdDivisionBranzas) {
      if (division >= start && division <= end) return branza;
    }
  }
  const cats = toStringArray(categories);
  if (cats.includes("szpitale")) return "zdrowie i opieka";
  if (cats.includes("wodociagi")) return "woda i odpady";
  return korytleOtherBranza;
}

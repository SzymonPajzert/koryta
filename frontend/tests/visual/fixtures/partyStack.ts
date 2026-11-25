import type { PartyStackResponse } from "../../../server/api/stats/partyStack.get";

/** A stand-in for `/api/stats/partyStack?category=szpitale`, for the capture
 * of „Partie w czasie” on /eksploruj/autograf.
 *
 * WHY A FIXTURE AND NOT THE SEED. The seeded world has a handful of people,
 * so every band would be a sliver along the axis and the stack, which is what
 * the capture is for, would have nothing to show.
 *
 * WHAT IT IS SHAPED FOR. Production's hospitals on 2026-11-25: each band's
 * value at five anchor months, straight between them, parts of a person and
 * all, as the even split between a person's parties leaves them.
 */

const FIRST = "2014-01";
const LAST = "2026-11";

/** Every month from FIRST to LAST, `YYYY-MM`. */
function monthRange(): string[] {
  const start = Number(FIRST.slice(0, 4)) * 12 + Number(FIRST.slice(5, 7)) - 1;
  const end = Number(LAST.slice(0, 4)) * 12 + Number(LAST.slice(5, 7)) - 1;
  return Array.from({ length: end - start + 1 }, (_, i) => {
    const index = start + i;
    const month = String((index % 12) + 1).padStart(2, "0");
    return `${Math.floor(index / 12)}-${month}`;
  });
}

/** The months the anchors below are given at, in order. */
const ANCHORS = ["2014-01", "2016-06", "2020-06", "2023-12", "2026-11"];

/** A band through its values at the anchor months, straight between them, to
 * a thousandth of a person as the server rounds them. */
function counts(months: string[], values: number[]): number[] {
  const at = ANCHORS.map((month) => months.indexOf(month));
  return months.map((_, i) => {
    let k = 0;
    while (k < at.length - 2 && at[k + 1]! <= i) k++;
    const share = (i - at[k]!) / (at[k + 1]! - at[k]!);
    const value = values[k]! + (values[k + 1]! - values[k]!) * share;
    return Math.round(value * 1000) / 1000;
  });
}

export function partyStackFixture(): PartyStackResponse {
  const months = monthRange();
  const band = (key: string, label: string, values: number[]) => ({
    key,
    label,
    counts: counts(months, values),
  });

  return {
    months,
    // Bottom of the stack first, as the server sends it.
    series: [
      band("PO", "PO", [97.917, 123.083, 146.667, 179.333, 270.583]),
      band("PiS", "PiS", [37.417, 69.083, 169.5, 204.167, 205.583]),
      band("PSL", "PSL", [36.417, 50.75, 58.167, 68.833, 89.583]),
      band("Polska 2050", "Polska 2050", [4.417, 6.083, 7, 9.5, 18.583]),
      band(
        "Nowa Lewica",
        "Nowa Lewica / SLD",
        [21.167, 21.333, 26.167, 27.833, 39.5],
      ),
      band("Inne", "Inne partie", [18.666, 24.666, 40.5, 58.333, 63.167]),
    ],
    coverage: { posts: 1821, people: 1199 },
    posts: 1894,
    today: LAST,
  };
}

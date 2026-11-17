import type { HomeTimelineResponse } from "../../../server/api/stats/homeTimeline.get";
import { OTHER_KEY } from "../../../shared/homeTimeline";

/** A stand-in for `/api/stats/homeTimeline`, for the capture of the home
 * chart „Stanowiska” with its tooltip open.
 *
 * WHY A FIXTURE AND NOT THE SEED. The seeded world has a handful of people, so
 * no grouping folds a remainder and every line sits near zero: the tooltip's
 * order, which is what the capture is for, would have nothing to sort.
 *
 * WHAT IT IS SHAPED FOR. Production's lines on 2026-11-17, roughly: their
 * values at five anchor months, straight between them. Under „Województwa”
 * the folded remainder is the highest line yet the last series, and under
 * „Partie” PO and PiS cross twice.
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
const ANCHORS = ["2014-01", "2017-06", "2021-06", "2024-06", "2026-11"];

/** A line through its values at the anchor months, straight between them. */
function counts(months: string[], values: number[]): number[] {
  const at = ANCHORS.map((month) => months.indexOf(month));
  return months.map((_, i) => {
    let k = 0;
    while (k < at.length - 2 && at[k + 1]! <= i) k++;
    const share = (i - at[k]!) / (at[k + 1]! - at[k]!);
    return Math.round(values[k]! + (values[k + 1]! - values[k]!) * share);
  });
}

export function homeTimelineFixture(): HomeTimelineResponse {
  const months = monthRange();
  const line = (key: string, label: string, values: number[]) => ({
    key,
    label,
    counts: counts(months, values),
  });

  return {
    months,
    groupings: {
      party: [
        line("PiS", "PiS", [250, 470, 700, 610, 545]),
        line("PO", "PO", [480, 461, 515, 564, 675]),
        line("PSL", "PSL", [190, 223, 250, 260, 315]),
        line("Inne", "Inne", [170, 201, 245, 227, 227]),
        line("Nowa Lewica", "Nowa Lewica / SLD", [90, 100, 120, 140, 152]),
        line("Polska 2050", "Polska 2050", [0, 0, 60, 90, 101]),
        line(
          "Bezpartyjni Samorządowcy",
          "Bezpartyjni Samorządowcy",
          [20, 25, 30, 35, 36],
        ),
        line(OTHER_KEY, "Pozostałe partie", [10, 12, 15, 18, 21]),
      ],
      region: [
        line("14", "Województwo mazowieckie", [250, 331, 441, 396, 408]),
        line("24", "Województwo śląskie", [120, 174, 223, 223, 229]),
        line("02", "Województwo dolnośląskie", [100, 140, 183, 190, 197]),
        line("12", "Województwo małopolskie", [110, 145, 180, 187, 197]),
        line("30", "Województwo wielkopolskie", [90, 120, 150, 145, 142]),
        line("06", "Województwo lubelskie", [70, 100, 125, 127, 127]),
        line("18", "Województwo podkarpackie", [60, 95, 120, 125, 127]),
        line(OTHER_KEY, "Pozostałe województwa", [320, 418, 539, 541, 647]),
      ],
      category: [
        line("szpitale", "Szpitale", [160, 223, 346, 410, 615]),
        line("wodociagi", "Wodociągi i kanalizacja", [130, 152, 242, 286, 375]),
        line("odpady", "Odpady i recykling", [40, 60, 85, 84, 133]),
        line(
          "komunikacja-miejska",
          "Komunikacja miejska i autobusowa",
          [30, 50, 80, 90, 110],
        ),
        line("energetyka", "Energetyka", [50, 55, 94, 60, 34]),
        line("cieplownictwo", "Ciepłownictwo", [58, 57, 89, 90, 94]),
        line("koleje", "Koleje", [30, 45, 60, 70, 79]),
        line(OTHER_KEY, "Pozostałe branże", [40, 50, 94, 109, 134]),
      ],
    },
    coverage: {
      party: { posts: 10957, people: 2335 },
      region: { posts: 11784, people: 2653 },
      category: { posts: 4576, people: 2095 },
    },
    posts: 11914,
    today: LAST,
  };
}

import { categoryTitle, isKnownCategory } from "./companyCategories";
import type { TimelineSeries } from "./homeTimeline";
import { parties } from "./misc";

/** How many points the share card draws the stack through. Each point costs
 * every band two characters of the card's url, which a platform has to be
 * willing to fetch: 48 points over seven bands is under 700. */
export const CARD_POINTS = 48;

/** Heights and positions travel as thousandths: of the tallest point of the
 * stack, and of the axis. How many pixels that is, the card decides. */
export const CARD_SCALE = 1000;

/** Base 36, two characters a number: what `encodeURIComponent` leaves alone,
 * and room for CARD_SCALE. */
const DIGITS = 2;
const CHUNK = new RegExp(`.{1,${DIGITS}}`, "g");

/** What `PartyStackCard.satori.vue` is given. Plain strings only: nuxt-og-image
 * puts an ASCII string into the card's url as it is, where an object or an
 * array would go in as base64 JSON, a third longer. */
export type PartyStackCardProps = {
  /** „Stanowiska wg partii: Szpitale”. Not `title`: nuxt-og-image fills a prop
   * of that name with the page's <title> when it is left out. */
  heading: string;
  /** „2014-2026”, or one year. */
  years: string;
  /** The bands, `encodeStack`. */
  stack: string;
  /** The years labelled on the axis, `encodeTicks`. */
  ticks: string;
};

export type CardStack = {
  /** Party names, bottom of the stack first. */
  keys: string[];
  /** Each band's thickness at every point, in thousandths of the tallest
   * point. */
  heights: number[][];
};

/** A labelled year: where its January falls, in thousandths of the axis. */
export type CardTick = { year: number; at: number };

/** The chart's name, on the page and on its card. */
export function partyStackHeading(category: string | null | undefined): string {
  return category && isKnownCategory(category)
    ? `Stanowiska wg partii: ${categoryTitle(category)}`
    : "Stanowiska wg partii";
}

function encodeNumber(value: number): string {
  const kept = Math.min(36 ** DIGITS - 1, Math.max(0, Math.round(value)));
  return kept.toString(36).padStart(DIGITS, "0");
}

/** `0.1.2.10!000a0b…!…`: the bands' places in `parties`, then each band's
 * heights, two characters apiece. */
export function encodeStack({ keys, heights }: CardStack): string {
  return [
    keys.map((key) => parties.indexOf(key)).join("."),
    ...heights.map((row) => row.map(encodeNumber).join("")),
  ].join("!");
}

/** The reverse of `encodeStack`. Tolerant: the string arrives from a url, so a
 * band it cannot name is left out rather than drawn in the wrong colour. */
export function decodeStack(encoded: unknown): CardStack {
  const [head = "", ...rows] = String(encoded ?? "").split("!");
  const keys: string[] = [];
  const heights: number[][] = [];
  head.split(".").forEach((index, band) => {
    const key = /^\d+$/.test(index) ? parties[Number(index)] : undefined;
    const row = rows[band];
    if (key === undefined || row === undefined) return;
    keys.push(key);
    heights.push(
      (row.match(CHUNK) ?? []).map((chunk) => parseInt(chunk, 36) || 0),
    );
  });
  return { keys, heights };
}

/** `2005-15!2010-208`: each year and where it falls. Not `2005.15`, which the
 * card's url would hand back as a number when it is the only one. */
export function encodeTicks(ticks: CardTick[]): string {
  return ticks.map(({ year, at }) => `${year}-${Math.round(at)}`).join("!");
}

export function decodeTicks(encoded: unknown): CardTick[] {
  return String(encoded ?? "")
    .split("!")
    .flatMap((pair) => {
      const match = /^(\d{4})-(\d+)$/.exec(pair);
      if (!match) return [];
      return [
        { year: Number(match[1]), at: Math.min(CARD_SCALE, Number(match[2])) },
      ];
    });
}

/** A labelled year every so often: about six over any range. */
function tickStep(span: number): number {
  if (span <= 7) return 1;
  if (span <= 14) return 2;
  return 5;
}

/** The card for one view of „Partie w czasie”: the category and the years on
 * screen, the stack sampled at CARD_POINTS points. Null when there is nothing
 * to draw, and the page then keeps the site's card. */
export function partyStackCardProps(
  stack: { months: string[]; series: TimelineSeries[] },
  years: [number, number] | null,
  category: string | null | undefined,
): PartyStackCardProps | null {
  const { months } = stack;
  const bands = stack.series.filter((band) => parties.includes(band.key));
  if (months.length < 2 || bands.length === 0) return null;

  const yearOf = (month: string) => Number(month.slice(0, 4));
  const firstYear = yearOf(months[0]!);
  const lastYear = yearOf(months.at(-1)!);
  const [wantFrom, wantTo] = years ?? [firstYear, lastYear];
  const from = Math.min(Math.max(wantFrom, firstYear), lastYear);
  const to = Math.max(Math.min(wantTo, lastYear), from);

  // Two months at least, as on the page: one is a line nobody can see.
  let start = months.findIndex((month) => yearOf(month) >= from);
  let end = months.length - 1;
  while (end > start && yearOf(months[end]!) > to) end -= 1;
  if (end === start) {
    if (start > 0) start -= 1;
    else end += 1;
  }

  const width = end - start + 1;
  const count = Math.min(CARD_POINTS, width);
  const points = Array.from(
    { length: count },
    (_, i) => start + Math.round((i * (width - 1)) / (count - 1)),
  );

  const totals = points.map((index) =>
    bands.reduce((sum, band) => sum + (band.counts[index] ?? 0), 0),
  );
  const tallest = Math.max(...totals);
  if (!(tallest > 0)) return null;

  // Each band's top is rounded as a running total, once: rounding every band
  // on its own would let the outline of the stack wobble a unit per band.
  const scale = CARD_SCALE / tallest;
  const running = points.map(() => 0);
  const below = points.map(() => 0);
  const heights = bands.map((band) =>
    points.map((index, i) => {
      running[i] = (running[i] ?? 0) + (band.counts[index] ?? 0);
      const top = Math.round(running[i] * scale);
      const height = top - (below[i] ?? 0);
      below[i] = top;
      return height;
    }),
  );

  const shownFrom = yearOf(months[start]!);
  const shownTo = yearOf(months[end]!);
  const step = tickStep(shownTo - shownFrom);
  const ticks: CardTick[] = [];
  for (
    let year = Math.ceil(shownFrom / step) * step;
    year <= shownTo;
    year += step
  ) {
    const index = months.indexOf(`${year}-01`);
    if (index < start || index > end) continue;
    ticks.push({ year, at: ((index - start) / (end - start)) * CARD_SCALE });
  }

  return {
    heading: partyStackHeading(category),
    years: shownFrom === shownTo ? `${shownFrom}` : `${shownFrom}-${shownTo}`,
    stack: encodeStack({ keys: bands.map((band) => band.key), heights }),
    ticks: encodeTicks(ticks),
  };
}

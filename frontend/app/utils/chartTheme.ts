import type { ActivityKind } from "~~/shared/activity";

/**
 * The chart palette and the chrome every chart on the site shares.
 *
 * Every hex here is a documented slot of the data-viz reference palette, and
 * the combinations in use were run through its validator against this app's
 * white card surface rather than picked by eye:
 *
 * - the four `activityColors` are categorical slots 1-4, checked as a stack
 *   (adjacent pairs) against this surface: worst CVD ΔE 9.1 (protan,
 *   yellow↔aqua), worst normal-vision ΔE 22.9 (the same pair). There were seven
 *   of them, through slot 7, until the kinds were merged down to four; the four
 *   that remain kept the first four slots rather than their old hues, so the
 *   stack is still a prefix of the fixed order and every adjacent pair in it is
 *   one the validator had already passed;
 * - `diverging.negative` / `diverging.positive` are slots 8 and 1, checked
 *   all-pairs: CVD ΔE 21.6.
 *
 * Aqua, yellow and magenta sit below 3:1 against white, which the method allows
 * only with relief — so every chart using them ships a table view of the same
 * numbers. Do not add a fifth activity colour without re-running the
 * validator; the slot *order* is the colourblind-safety mechanism, not
 * decoration, so a new kind takes the next slot rather than a hue picked to
 * suit it - and is appended to `activityKinds`, so the stack stays in slot
 * order too. Slot 8 is the last one; a ninth kind needs a new palette, not a
 * ninth hex.
 *
 * The app has one theme (light), so there are no dark steps to select.
 */

/** Categorical slots 1-8, in the order the method fixes them. */
export const categorical = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/** Chart chrome. Text never wears a series colour; these are what labels,
 * axes and gridlines use instead. */
export const ink = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  /** The surface a chart is drawn on - also what the 2px gaps are painted in. */
  surface: "#ffffff",
  /** The "nothing here yet" remainder of a part-to-whole bar. */
  track: "#e2e0dc",
} as const;

/** Reserved for state, never for identity. Always shipped with a label. */
export const status = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

/** Polarity: a warm and a cool pole that read as opposite, with a neutral grey
 * for the midpoint that has to read as "nothing". */
export const diverging = {
  negative: "#e34948",
  positive: "#2a78d6",
  neutral: "#f0efec",
} as const;

/** One colour per interaction kind, fixed for the whole site so a kind keeps
 * its colour between the timeline, the tiles and the leaderboard. Colour
 * follows the kind, never its current rank. */
export const activityColors: Record<ActivityKind, string> = {
  vote: categorical[0],
  revision: categorical[1],
  noteSource: categorical[2],
  publication: categorical[3],
};

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Apex options every chart starts from: no toolbar, no animation on refetch,
 * hairline solid grid, text in ink tokens. */
export function baseChartOptions() {
  return {
    chart: {
      fontFamily: FONT_FAMILY,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: false },
      background: "transparent",
      parentHeightOffset: 0,
    },
    grid: {
      borderColor: ink.grid,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
    },
    dataLabels: { enabled: false },
    tooltip: { style: { fontFamily: FONT_FAMILY } },
    legend: {
      position: "bottom" as const,
      horizontalAlign: "left" as const,
      fontFamily: FONT_FAMILY,
      labels: { colors: ink.secondary },
      markers: { size: 6, shape: "circle" as const },
      itemMargin: { horizontal: 10, vertical: 4 },
    },
    xaxis: {
      axisBorder: { color: ink.axis },
      axisTicks: { color: ink.axis },
      labels: { style: { colors: ink.muted, fontFamily: FONT_FAMILY } },
    },
    yaxis: {
      labels: { style: { colors: ink.muted, fontFamily: FONT_FAMILY } },
    },
    states: { hover: { filter: { type: "lighten", value: 0.08 } } },
  };
}

/** How much of its slot a column fills - the whole of the thickness rule, since
 * a percentage is the only handle ApexCharts gives.
 *
 * There was a `maxBarThickness: 24` next to it for a while, the cap the method
 * asks for. ApexCharts has no such option - it is Chart.js's - so it was never
 * read and the percentage was doing the work by itself, at 60%: two fifths of
 * every slot painted as air, which on the five-bucket and ten-step charts of
 * /eksploruj/statystyki put more gap between neighbours than a separation needs.
 * 85% leaves the 2px surface gap that separates them and a little more.
 *
 * Nothing caps a bar drawn this way, so the container does it instead: every
 * page carrying one of these is 1200px wide at most (the layout's default -
 * `fullWidth` pages have no bar chart), which across two columns is a plot of
 * about 465px, so five categories are ~79px of bar. Fewer categories than that,
 * or a full-width page, and the columns are slabs - either wants its own
 * narrower percentage. */
const COLUMN_FILL = "85%";

/** Bar geometry the method fixes: a 4px rounded data end, and a 2px gap in the
 * surface colour doing the separating instead of a border. */
export function barPlotOptions(options: { horizontal?: boolean } = {}) {
  return {
    plotOptions: {
      bar: {
        horizontal: options.horizontal ?? false,
        borderRadius: 4,
        borderRadiusApplication: "end" as const,
        borderRadiusWhenStacked: "last" as const,
        columnWidth: COLUMN_FILL,
      },
    },
    stroke: { show: true, width: 2, colors: [ink.surface] },
  };
}

/** Thousands-separated the Polish way, so 12 345 rather than 12,345. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pl-PL").format(value);
}

/** Compact form for a stat tile that would otherwise wrap. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 10_000) return formatCount(value);
  return new Intl.NumberFormat("pl-PL", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/** "dzisiaj" / "3 dni temu" — how long ago an instant was, in whole days.
 *
 * A leaderboard row is read for recency, not for the minute somebody clicked,
 * and a relative phrase says that faster than a timestamp does. */
export function formatDaysAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";

  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "dzisiaj";
  if (days === 1) return "wczoraj";
  return new Intl.RelativeTimeFormat("pl-PL", { numeric: "always" }).format(
    -days,
    "day",
  );
}

/** `2026-08-02` as `2 sie`, which is what fits under a column. */
export function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parsed);
}

import plLocale from "apexcharts/dist/locales/pl.json";
import type { ActivityKind } from "~~/shared/activity";
import { OTHER_PARTY } from "~~/shared/misc";
import { escapeHtml } from "~~/shared/notifications";
import type { SearchEnding } from "~~/shared/searchLog";

/**
 * The chart palette and the chrome every chart on the site shares.
 *
 * Every hex here is a documented slot of the data-viz reference palette, and
 * the combinations in use were run through its validator against this app's
 * white card surface rather than picked by eye:
 *
 * - the five `activityColors` are categorical slots 1-5, checked as a stack
 *   (adjacent pairs) against this surface: worst CVD ΔE 9.1 (protan,
 *   yellow↔aqua), worst normal-vision ΔE 19.6 (magenta↔yellow, the pair the
 *   fifth added on 2026-11-02). There were seven of them, through slot 7, until
 *   the kinds were merged down to four; the four that remained kept the first
 *   four slots rather than their old hues, so the stack is still a prefix of
 *   the fixed order;
 * - `diverging.negative` / `diverging.positive` are slots 8 and 1, checked
 *   all-pairs: CVD ΔE 21.6.
 *
 * Aqua, yellow and magenta sit below 3:1 against white, which the method allows
 * only with relief — so every chart using them ships a table view of the same
 * numbers. Do not add a sixth activity colour without re-running the
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

/** The home page's map of Poland (chart/PolandMap.vue): the fills that carry
 * no party, and the lines. White lines between powiaty and grey voivodeship
 * borders replaced black ones (decision on 2026-11-18): the fills carry the
 * information and the lines recede, on a dark party fill as on a phone. */
export const choropleth = {
  /** Nobody on the site works in the powiat yet. */
  empty: "#fff6d5",
  /** Too few people with a party for a share to say anything. */
  thin: "#ebeae5",
  /** Two parties tied for the lead, or „Inne” leading: no party to paint. */
  tie: ink.axis,
  /** On one party's map: a powiat where nobody has that party. */
  none: "#f6f5f1",
  district: ink.surface,
  voivodeship: ink.secondary,
  /** The outline drawn round the powiat under the pointer. */
  hover: ink.primary,
} as const;

/** People in a powiat in six classes (1-4, 5-9, 10-19, 20-49, 50-99, 100+),
 * light to dark in the map's old red. What the map shows until the night's
 * recount has written party counts to the region rows. */
export const choroplethPeople = [
  "#fee0db",
  "#f9bdb3",
  "#ec988b",
  "#d96e60",
  "#c34235",
  "#a30101",
] as const;

/** The party most of a powiat's people have, in three steps of its share
 * among the people with a party: under 45%, 45-59%, 60% and up (decision on
 * 2026-11-18). Each step is the party's own hue, with `partyColors`' fill as
 * one of them, so the strongest map still reads as that party. Built in OKLCH
 * and checked with the data-viz validator as ordinal ramps: monotone
 * lightness, at least 0.06 between steps, one hue. */
export const choroplethLead: Record<string, readonly [string, string, string]> =
  {
    PO: ["#fdd6b2", "#fca241", "#c67712"],
    PiS: ["#a5c0e5", "#517cb5", "#073b76"],
    PSL: ["#b8f1d4", "#2ed396", "#23966a"],
    "Polska 2050": ["#fceec7", "#FFCB03", "#c29a07"],
    "Nowa Lewica": ["#ffa097", "#f75b54", "#D40E20"],
    Konfederacja: ["#b1bfd2", "#596d8a", "#102440"],
    Nowoczesna: ["#b7e9ee", "#00A9B7", "#017782"],
    "Bezpartyjni Samorządowcy": ["#c8b2e8", "#9a74c9", "#6A3D9A"],
  };

/** One party's map: its share of a powiat's people with a party, in four
 * steps (1-19%, 20-39%, 40-59%, 60% and up), built and checked as
 * `choroplethLead` is. „Inne” gets a ramp here though it never leads: its
 * own map is still a party's map. */
export const choroplethShare: Record<
  string,
  readonly [string, string, string, string]
> = {
  PO: ["#ffdec1", "#fdc18a", "#fca241", "#bd700c"],
  PiS: ["#d0e0f5", "#97b3d9", "#4f76a9", "#073b76"],
  PSL: ["#c5f1da", "#8ce2b8", "#2ed396", "#069869"],
  "Polska 2050": ["#f9eac4", "#FFCB03", "#d1a604", "#a58308"],
  "Nowa Lewica": ["#ffd2cc", "#f49288", "#e85c55", "#D40E20"],
  Konfederacja: ["#d7dfea", "#a4b2c6", "#556781", "#102440"],
  Nowoczesna: ["#c7edf1", "#81cad3", "#00A9B7", "#02717b"],
  "Bezpartyjni Samorządowcy": ["#e4d7f7", "#bca5dc", "#9270bd", "#6A3D9A"],
  [OTHER_PARTY]: ["#ecebe8", "#c3c2b7", "#9d9c92", "#797870"],
};

/** The greys two older party charts - the people bars on a region's page and
 * the company bars on /eksploruj - give the people no party colour accounts
 * for. They predate `ink` above and keep their own values, so that moving them
 * here changes nothing on either chart. */
export const partyRemainder = {
  /** Employed, but in no party the site has a colour for. */
  otherParty: "#888888",
  /** Not employed, on the region chart; no party, on the company bars. */
  none: "#e0e0e0",
  /** A region chart label nothing above names. */
  fallback: "#cccccc",
  /** A party with no colour of its own, on the company bars. */
  unknownParty: "#999999",
  /** The empty track behind the company bars. */
  track: "#f5f5f5",
} as const;

/** One colour per interaction kind, fixed for the whole site so a kind keeps
 * its colour between the timeline, the tiles and the leaderboard. Colour
 * follows the kind, never its current rank. */
export const activityColors: Record<ActivityKind, string> = {
  vote: categorical[0],
  revision: categorical[1],
  noteSource: categorical[2],
  publication: categorical[3],
  reading: categorical[4],
};

/** How a search ended, on /admin/wyszukiwania. These are states, not
 * identities - a result opened is the search box working, nothing found is it
 * failing - so they wear the status tokens rather than categorical slots, and
 * are stacked good, warning, critical so that green and red never touch.
 * Checked as a stack against white: worst adjacent CVD ΔE 11.3 (protan,
 * warning↔good), normal-vision 27.6. Warning sits below 3:1, which the
 * method allows for status with relief: the card's tiles name every band and
 * its table view carries every number. */
export const searchEndingColors: Record<SearchEnding, string> = {
  opened: status.good,
  notOpened: status.warning,
  nothing: status.critical,
};

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Apex options every chart starts from: no toolbar, no animation on refetch,
 * hairline solid grid, text in ink tokens. */
export function baseChartOptions() {
  return {
    chart: {
      // Apexcharts names months and days itself, out of a built-in English
      // locale, and no `Intl` call anywhere else in the app can reach that -
      // so a datetime axis on a Polish site read „Jan \'22, Jul \'22”. The
      // package ships the translation; this is what selects it. Charts on a
      // category axis are unaffected, their labels being strings we pass in.
      locales: [plLocale],
      defaultLocale: "pl",
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

/** One line of a line chart, as its row in a tooltip shows it. */
export type TooltipLine = { name: string; color: string };

/** What apexcharts hands a `tooltip.custom`, as far as `rankedTooltip` reads
 * it: every series' values, and the point under the pointer. */
type TooltipPoint = {
  series: (number | null | undefined)[][];
  dataPointIndex: number;
};

/** The circle apexcharts puts before each row of its own tooltip. */
const TOOLTIP_MARKER =
  '<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>';

/** A shared tooltip whose rows stand in the order the lines do at the hovered
 * point, the highest line first.
 *
 * apexcharts lists a shared tooltip's rows in series order whatever the values
 * are, and has no option to sort them. Where that is not the order of the
 * lines - the home chart's folded „pozostałe” comes last and is often its
 * highest line - a reader going down the rows goes up and down the chart. So
 * this writes the tooltip itself, in apexcharts' own markup and classes: its
 * stylesheet still draws it, and only the order is new.
 *
 * The values are counts. Ties keep series order. A line with no value at the
 * point has no row, as in apexcharts' own tooltip, which is also how a line
 * hidden from the legend drops out: apexcharts empties its data.
 *
 * The lines and the title are asked for each time the tooltip is drawn.
 * vue3-apexcharts hands every later options update to apexcharts through
 * JSON, which drops functions, so apexcharts goes on calling the first
 * tooltip it was given: lines baked into it stay those of the first chart.
 */
export function rankedTooltip(
  lines: () => TooltipLine[],
  title: (dataPointIndex: number) => string,
) {
  return ({ series, dataPointIndex }: TooltipPoint): string => {
    const rows = lines()
      .map((line, index) => ({
        line,
        index,
        value: series[index]?.[dataPointIndex],
      }))
      .filter(
        (row): row is { line: TooltipLine; index: number; value: number } =>
          typeof row.value === "number",
      )
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .map(({ line, value }) => tooltipRow(line, formatCount(value)));
    return tooltipTitle(title(dataPointIndex)) + rows.join("");
  };
}

/** One band of a stacked chart at the hovered point. */
export type StackTooltipRow = TooltipLine & { value: number };

/** A shared tooltip for a stacked chart: the bands top first, as they stand,
 * each with its count and its share of the point, and the point's total handed
 * to the title. A band with nobody in it at the point has no row.
 *
 * The rows are asked for each time, as in `rankedTooltip` and for the same
 * reason: apexcharts goes on calling the first tooltip it was given. */
export function stackTooltip(
  rows: (dataPointIndex: number) => StackTooltipRow[],
  title: (dataPointIndex: number, total: number) => string,
) {
  return ({ dataPointIndex }: { dataPointIndex: number }): string => {
    const bands = rows(dataPointIndex);
    const total =
      Math.round(bands.reduce((sum, band) => sum + band.value, 0) * 1000) /
      1000;
    return (
      tooltipTitle(title(dataPointIndex, total)) +
      bands
        .filter((band) => band.value > 0)
        .map((band) =>
          tooltipRow(
            band,
            `${formatPeople(band.value)} (${shareLabel(band.value, total)})`,
          ),
        )
        .join("")
    );
  };
}

/** A whole percent, and „<1%” for a part that would round down to „0%”:
 * one person in three hundred is not nobody. */
function shareLabel(part: number, whole: number): string {
  if (part > 0 && whole > 0 && (part / whole) * 100 < 0.5) return "<1%";
  return formatPercent(part, whole);
}

/** The font apexcharts sets on the same elements of its own tooltip. */
const TOOLTIP_FONT = escapeHtml(`font-family: ${FONT_FAMILY}; font-size: 12px`);

function tooltipTitle(text: string): string {
  return `<div class="apexcharts-tooltip-title" style="${TOOLTIP_FONT}">${escapeHtml(text)}</div>`;
}

/** A tooltip row in apexcharts' own markup, so its stylesheet draws it. */
function tooltipRow(line: TooltipLine, value: string): string {
  return (
    `<div class="apexcharts-tooltip-series-group apexcharts-active" style="display: flex">` +
    `<span class="apexcharts-tooltip-marker" style="color: ${escapeHtml(line.color)}">${TOOLTIP_MARKER}</span>` +
    `<div class="apexcharts-tooltip-text" style="${TOOLTIP_FONT}">` +
    `<div class="apexcharts-tooltip-y-group">` +
    `<span class="apexcharts-tooltip-text-y-label">${escapeHtml(line.name)}: </span>` +
    `<span class="apexcharts-tooltip-text-y-value">${escapeHtml(value)}</span>` +
    `</div></div></div>`
  );
}

/** Bar geometry the method fixes: capped thickness, a 4px rounded data end, and
 * a 2px gap in the surface colour doing the separating instead of a border. */
export function barPlotOptions(options: { horizontal?: boolean } = {}) {
  return {
    plotOptions: {
      bar: {
        horizontal: options.horizontal ?? false,
        borderRadius: 4,
        borderRadiusApplication: "end" as const,
        borderRadiusWhenStacked: "last" as const,
        columnWidth: "60%",
        maxBarThickness: 24,
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

/** A count of people that can hold parts of a person, as a stack shared out
 * between parties does: one decimal at most, „12,5”. */
export function formatPeople(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(
    value,
  );
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

/** A part of a 100% column as the tooltip gives it: its share, then the count
 * it stands for, `45% (19)`. */
export function formatShare(part: number, whole: number): string {
  return `${formatPercent(part, whole)} (${formatCount(part)})`;
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

/** The days a column covers: `20-26 paź`, `29 wrz-5 paź` across a month's
 * end, and one day as itself. */
export function formatDayRange(first: string, last: string): string {
  if (first === last) return formatDayLabel(first);
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${Number(first.slice(8, 10))}-${formatDayLabel(last)}`;
  }
  return `${formatDayLabel(first)}-${formatDayLabel(last)}`;
}

/** How far apart two dates under a column chart have to be. `30 wrz` is about
 * 36px of apexcharts' 12px axis text; the rest is the air that makes two
 * neighbours read as two dates rather than one run of text. */
const DAY_LABEL_SPACING_PX = 48;

/** Every day, every other day, or whole weeks - weeks rather than every third
 * or fifth day, so that the labels all fall on one weekday. */
const DAY_LABEL_STEPS = [1, 2, 7, 14, 28] as const;

/** How many days apart to label `days` columns drawn across `plotWidthPx`: the
 * shortest step that leaves each date its room. */
export function dayLabelStep(days: number, plotWidthPx: number): number {
  const column = plotWidthPx / Math.max(days, 1);
  return (
    DAY_LABEL_STEPS.find((step) => step * column >= DAY_LABEL_SPACING_PX) ??
    DAY_LABEL_STEPS[DAY_LABEL_STEPS.length - 1]!
  );
}

/** A category axis formatter that keeps every `step`-th day's label and blanks
 * the rest, counted back from the last column so that today always has one.
 *
 * apexcharts hands the tooltip's title to this formatter too, without an
 * index, and gets a blank back: a chart with a tooltip names the day there
 * with a `tooltip.x.formatter` of its own. */
export function everyNthDayLabel(days: number, step: number) {
  return (value: string, _raw: unknown, opts?: { i?: number }) => {
    const index = opts?.i ?? -1;
    return index >= 0 && (days - 1 - index) % step === 0 ? value : "";
  };
}

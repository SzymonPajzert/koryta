import {
  activityKindLabels,
  activityKinds,
  type ActivityCounts,
} from "~~/shared/activity";
import { polishCountingGrouped } from "~/composables/polish";
import {
  barPlotOptions,
  baseChartOptions,
  categorical,
  formatCount,
  formatDayLabel,
  ink,
} from "~/utils/chartTheme";

export type MonthDay = { date: string; counts: ActivityCounts; total: number };

const FULL_DAY = new Intl.DateTimeFormat("pl-PL", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `2026-09-24` as `czw., 24 wrz` - the tooltip's title. */
export function fullDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return FULL_DAY.format(parsed);
}

/** Tops for the value axis above 10, per power of ten. Finer than the 1-2-5
 * steps apexcharts rounds to: with only three ticks those put a 101-change day
 * under a 200 ceiling and left the top half of the card empty. */
const NICE_STEPS = [10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];

/** The busiest day rounded up to where the axis should end. The axis is
 * labelled at 0, half way and the top, so the top is even - a count has no
 * half-change tick. */
export function niceAxisMax(max: number): number {
  if (!(max > 0)) return 2;
  if (max <= 10) return Math.max(2, Math.ceil(max / 2) * 2);
  const unit = 10 ** (Math.floor(Math.log10(max)) - 1);
  const top = NICE_STEPS.map((step) => step * unit).find(
    (value) => value >= max && value % 2 === 0,
  );
  return top ?? 100 * unit;
}

/** Week-spaced labels counted back from today, so the last column is always
 * one of them. */
function weeklyLabel(daily: MonthDay[]) {
  return (value: string, _raw: unknown, opts?: { i?: number }) => {
    const index = opts?.i ?? -1;
    return index >= 0 && (daily.length - 1 - index) % 7 === 0 ? value : "";
  };
}

/** Columns fill most of their day, as on the full chart on
 * /eksploruj/statystyki: thirty days are meant to read as one shape across
 * time, not as thirty pins. See `ActivityTimeline.vue`. */
const COLUMN_WIDTH = "90%";
const MAX_COLUMN_PX = 48;

/** The surface-coloured line between neighbouring columns. 1px, as on the full
 * chart: at the 2px every other chart uses, the gaps ate a quarter of a column
 * on a phone, where a day is 8px wide. */
const COLUMN_GAP_PX = 1;

/** Axis text a shade darker than the site's other charts. Their `ink.muted`
 * is 3.6:1 on white, under the 4.5:1 that 12px text needs, and on a chart this
 * small the three ticks and five dates are all the scale there is. */
const AXIS_TEXT = { colors: ink.secondary };

/** Room right of the last column for its label, which is centred under it and
 * is always drawn - it is today. Without it `24 wrz` lost its last letters. */
const LAST_LABEL_ROOM_PX = 16;

/** The tooltip for one day: the date, its total, and the four kinds that made
 * it up - the split the one-colour columns leave out. Everything in it is our
 * own labels and numbers, so there is nothing to escape. */
function dayTooltip(daily: MonthDay[]) {
  return ({ dataPointIndex }: { dataPointIndex: number }) => {
    const day = daily[dataPointIndex];
    if (!day) return "";
    const kinds = activityKinds
      .map(
        (kind) =>
          `<li><span>${activityKindLabels[kind]}</span><b>${formatCount(day.counts[kind])}</b></li>`,
      )
      .join("");
    return (
      `<div class="amc-tip">` +
      `<div>${fullDayLabel(day.date)}</div>` +
      `<div class="amc-tip__total">${polishCountingGrouped(day.total, "zmiana", "zmiany", "zmian")}</div>` +
      `<ul class="amc-tip__kinds">${kinds}</ul>` +
      `</div>`
    );
  };
}

/** One column per day, its total, in the first categorical slot. */
export function monthChartOptions(daily: MonthDay[]) {
  const base = baseChartOptions();
  const bar = barPlotOptions();
  const busiest = Math.max(0, ...daily.map((day) => day.total));
  return {
    ...base,
    chart: { ...base.chart, type: "bar" },
    colors: [categorical[0]],
    // Apexcharts paints bars at 85% by default, a paler blue than the one the
    // palette was checked with.
    fill: { opacity: 1 },
    grid: {
      ...base.grid,
      padding: { top: -12, right: LAST_LABEL_ROOM_PX, bottom: -4, left: 6 },
    },
    stroke: { ...bar.stroke, width: COLUMN_GAP_PX },
    plotOptions: {
      bar: {
        ...bar.plotOptions.bar,
        columnWidth: COLUMN_WIDTH,
        maxBarThickness: MAX_COLUMN_PX,
      },
    },
    xaxis: {
      ...base.xaxis,
      categories: daily.map((day) => formatDayLabel(day.date)),
      axisTicks: { show: false },
      tooltip: { enabled: false },
      labels: {
        ...base.xaxis.labels,
        style: { ...base.xaxis.labels.style, ...AXIS_TEXT },
        rotate: 0,
        hideOverlappingLabels: false,
        formatter: weeklyLabel(daily),
      },
    },
    yaxis: {
      ...base.yaxis,
      min: 0,
      max: niceAxisMax(busiest),
      tickAmount: 2,
      labels: {
        ...base.yaxis.labels,
        style: { ...base.yaxis.labels.style, ...AXIS_TEXT },
        formatter: (value: number) => String(Math.round(value)),
      },
    },
    tooltip: {
      ...base.tooltip,
      intersect: false,
      custom: dayTooltip(daily),
    },
    legend: { show: false },
  };
}

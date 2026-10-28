<template>
  <div ref="chartBox">
    <ClientOnly>
      <apexchart
        v-if="hasData"
        :key="drawKey"
        type="bar"
        height="340"
        :options="options"
        :series="series"
      />
      <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">
        {{ emptyText }}
      </div>
      <template #fallback>
        <v-skeleton-loader type="image" height="340" />
      </template>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  barPlotOptions,
  baseChartOptions,
  dayLabelStep,
  everyNthDayLabel,
  formatDayLabel,
  formatDayRange,
  ink,
} from "~/utils/chartTheme";

/** One stacked band of the columns: what it is, its colour, and its count on
 * each day. */
export type DailyColumnsBand = {
  key: string;
  label: string;
  color: string;
  /** One count per day, in the order of `dates`. */
  values: number[];
};

/** A column per day, each the day's total broken into the bands that made it
 * up, bottom to top in the order given. The days are a stretch of time, so
 * the columns are drawn to read as one series across it rather than as a row
 * of separate bars - see the widths below.
 *
 * The bands' colours are the caller's to choose and to validate as a stack;
 * `chartTheme.ts` says how. */
const props = withDefaults(
  defineProps<{
    /** `YYYY-MM-DD`, oldest first, one per column: the column's first day. */
    dates: string[];
    /** Each column's last day, where a column adds up several - a week. The
     * tooltip then names the whole stretch; the axis keeps the first day. */
    ends?: string[];
    bands: DailyColumnsBand[];
    /** What the value axis counts, e.g. „Liczba zmian”. */
    valueTitle: string;
    /** Said in place of the chart when every column is empty. */
    emptyText: string;
    /** Apexcharts' own legend under the columns. Off only where something
     * else beside the chart names every band with its colour. */
    legend?: boolean;
    /** Each column as shares of its day rather than counts. */
    shares?: boolean;
  }>(),
  { ends: () => [], legend: true, shares: false },
);

/** Past this many columns a value on every cap is noise rather than a label. */
const DIRECT_LABEL_LIMIT = 14;

/** How much of a day's slot the column fills, and how wide it may ever get.
 *
 * Both are wider than `barPlotOptions` gives a bar by default (60% of the slot,
 * 24px), and deliberately. The shared numbers are the mark spec for a chart of a
 * handful of named categories, where a thin mark with air around it reads as one
 * thing per band. Here the bands are consecutive days: the axis is a stretch of
 * time and the columns are supposed to read as a series across it, which at 30
 * days and full width they stopped doing - a 24px cap against a 37px slot puts a
 * third of the width between neighbours, and the eye reads scattered pins rather
 * than a shape. 90% leaves the 2px surface gap that separates them and nothing
 * more; the cap is what keeps a 7-day window, where a slot is 157px, from
 * drawing slabs.
 *
 * The cap is a share of the slot, worked out from the measured width below:
 * apexcharts has no maximum bar width of its own. The `maxBarThickness` this
 * chart was first given is Chart.js's name, and apexcharts ignored it - a
 * single day drew one column across the whole card. */
const COLUMN_SHARE = 0.9;
const MAX_COLUMN_PX = 48;

/** About the width of the widest date under a column, `30 wrz` in apexcharts'
 * 12px axis text. The last column's date is always drawn - it is today - and
 * centred under it, so a column narrower than this needs the difference to its
 * right or the date loses its last letters. */
const DATE_LABEL_PX = 36;

/** The surface-coloured line between two stacked segments of one day.
 *
 * `barPlotOptions` draws it 2px wide, which is the method's spacer and what
 * every other chart on the site uses. This one is denser than they are - four
 * bands on every column, 30 or 90 columns across - so the separators add up to
 * a visible amount of the ink, and at 2px they read as part of the pattern
 * rather than as the absence of one. 1px still separates, which is what the
 * palette needs it for: two of these four hues are only allowed adjacent
 * because a gap keeps them apart. Zero is not an option for that reason. */
const SEGMENT_GAP_PX = 1;

/** What the value axis and its title take off the left of the chart, so that
 * the rest is the width the columns share. */
const VALUE_AXIS_PX = 50;

/** How wide the chart is drawn, which is what decides how many dates fit under
 * it. Measured rather than read off `useDisplay()`: the window is not the
 * chart - on a desktop the page stops at 1200px, and on a phone the layout's,
 * the page's and the card's padding take a quarter of it. A zero is the table
 * view hiding the chart, and keeps the last real width. */
const chartBox = ref<HTMLElement | null>(null);
const chartWidth = ref(0);
let resizeObserver: ResizeObserver | undefined;

const measure = (width: number) => {
  if (width > 0) chartWidth.value = width;
};

onMounted(() => {
  if (!chartBox.value) return;
  measure(chartBox.value.clientWidth);
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) measure(entry.contentRect.width);
  });
  resizeObserver.observe(chartBox.value);
});

onBeforeUnmount(() => resizeObserver?.disconnect());

/** Every other day on a desktop's month, once a week on a phone's - reported
 * from a 375px screen, where fifteen dates ran into each other. A number, so
 * the chart is redrawn when the step changes and not on every pixel of a
 * resize. */
const labelStep = computed(() =>
  dayLabelStep(props.dates.length, chartWidth.value - VALUE_AXIS_PX),
);

/** The width one day gets, or 0 before the chart has been measured. */
const slotPx = computed(() =>
  Math.max(
    0,
    (chartWidth.value - VALUE_AXIS_PX) / Math.max(props.dates.length, 1),
  ),
);

const columnWidth = computed(() => {
  const share = slotPx.value
    ? Math.min(COLUMN_SHARE, MAX_COLUMN_PX / slotPx.value)
    : COLUMN_SHARE;
  return `${Math.round(share * 100)}%`;
});

/** The room the last date needs right of the plot. */
const lastDateRoom = computed(() =>
  slotPx.value ? Math.max(0, Math.ceil((DATE_LABEL_PX - slotPx.value) / 2)) : 0,
);

const hasData = computed(() =>
  props.bands.some((band) => band.values.some((value) => value > 0)),
);

const series = computed(() =>
  props.bands.map((band) => ({ name: band.label, data: band.values })),
);

const options = computed(() => {
  const base = baseChartOptions();
  const labelEveryCap = props.dates.length <= DIRECT_LABEL_LIMIT;

  return {
    ...base,
    chart: {
      ...base.chart,
      type: "bar",
      stacked: true,
      ...(props.shares ? { stackType: "100%" } : {}),
    },
    colors: props.bands.map((band) => band.color),
    ...barPlotOptions(),
    stroke: { ...barPlotOptions().stroke, width: SEGMENT_GAP_PX },
    legend: { ...base.legend, show: props.legend },
    // Only where it is needed, so a chart whose dates fit is drawn as before.
    ...(lastDateRoom.value
      ? { grid: { ...base.grid, padding: { right: lastDateRoom.value } } }
      : {}),
    plotOptions: {
      bar: {
        ...barPlotOptions().plotOptions.bar,
        columnWidth: columnWidth.value,
        // The running total on the cap, but only while the columns are far
        // enough apart for it to be read. A count, also over shares.
        dataLabels: {
          total: {
            enabled: labelEveryCap,
            formatter: (value: number) => String(Math.round(value)),
            style: {
              color: ink.secondary,
              fontSize: "11px",
              fontWeight: 500,
            },
            offsetY: -4,
          },
        },
      },
    },
    xaxis: {
      ...base.xaxis,
      categories: props.dates.map(formatDayLabel),
      // Not `tickAmount`, which thinned the labels by count alone - every
      // other day of a month whether the chart was 1100px wide or 230px.
      labels: {
        ...base.xaxis.labels,
        rotate: 0,
        formatter: everyNthDayLabel(props.dates.length, labelStep.value),
      },
    },
    yaxis: {
      ...base.yaxis,
      title: { text: props.valueTitle, style: { color: ink.muted } },
      // Whole counts only; a fractional tick on a count is nonsense.
      forceNiceScale: true,
      labels: {
        ...base.yaxis.labels,
        formatter: (value: number) =>
          props.shares ? `${Math.round(value)}%` : String(Math.round(value)),
      },
    },
    tooltip: {
      ...base.tooltip,
      shared: true,
      intersect: false,
      // The day under the pointer, labelled on the axis or not, or all the
      // days its column adds up.
      x: {
        formatter: (value: string, opts?: { dataPointIndex?: number }) => {
          const index = opts?.dataPointIndex ?? -1;
          const first = props.dates[index];
          const last = props.ends[index];
          return first && last ? formatDayRange(first, last) : value;
        },
      },
    },
  };
});

/** Draws the chart anew whenever what it shows changes, rather than updating
 * it in place.
 *
 * vue3-apexcharts hands an update to apexcharts through `JSON.stringify`,
 * which drops every function in the options - the axes' and the tooltip's
 * formatters - so an updated chart kept the ones it was first drawn with:
 * switched to shares, its axis went on counting, and given a different number
 * of columns, it put the dates where the old count of columns had them. The
 * label step is in the key on its own because it lives only inside a
 * formatter. */
const drawKey = computed(() =>
  JSON.stringify([options.value, series.value, labelStep.value]),
);
</script>

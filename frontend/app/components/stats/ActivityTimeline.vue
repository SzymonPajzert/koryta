<template>
  <StatsChartCard
    title="Co się działo w bazie"
    :subtitle="subtitle"
    :loading="loading"
  >
    <template #chart>
      <ClientOnly>
        <apexchart
          v-if="hasData"
          type="bar"
          height="340"
          :options="options"
          :series="series"
        />
        <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">
          W tym okresie nikt nic nie zmieniał.
        </div>
        <template #fallback>
          <v-skeleton-loader type="image" height="340" />
        </template>
      </ClientOnly>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Dzień</th>
            <th v-for="kind in activityKinds" :key="kind" class="text-right">
              {{ activityKindLabels[kind] }}
            </th>
            <th class="text-right">Razem</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="day in reversed" :key="day.date">
            <td>{{ formatDayLabel(day.date) }}</td>
            <td
              v-for="kind in activityKinds"
              :key="kind"
              class="text-right stats-numeric"
            >
              {{ day.counts[kind] }}
            </td>
            <td class="text-right font-weight-medium stats-numeric">
              {{ day.total }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  activityKinds,
  activityKindLabels,
  type ActivityCounts,
} from "~~/shared/activity";
import {
  activityColors,
  barPlotOptions,
  baseChartOptions,
  formatDayLabel,
  ink,
} from "~/utils/chartTheme";

/** Columns show a day's total broken into the kinds of change that made it up,
 * which is what "co się działo" means here: one stacked series per interaction
 * the site records, in `activityKinds` order.
 *
 * Four bands, which is inside the method's comfortable ceiling for a stack - it
 * was seven, and a legend of seven over a column chart is a key the reader has
 * to learn before the chart says anything. The legend is still always on and the
 * table view below still carries every number: two of the four hues sit below
 * 3:1 on white and are only allowed with that relief. See `chartTheme.ts` before
 * adding a fifth. */
const props = defineProps<{
  daily: { date: string; counts: ActivityCounts; total: number }[];
  loading?: boolean;
}>();

/** Past this many columns a value on every cap is noise rather than a label. */
const DIRECT_LABEL_LIMIT = 14;

/** How much of a day's slot the column fills.
 *
 * Wider than the 85% `barPlotOptions` gives a bar, and deliberately. The shared
 * number is the mark spec for a chart of a handful of named categories, where a
 * little air around each mark reads as one thing per band. Here the bands are
 * consecutive days: the axis is a stretch of time and the columns are supposed
 * to read as a series across it, which at 30 days and full width they stopped
 * doing - the eye read scattered pins rather than a shape. 90% leaves the 2px
 * surface gap that separates them and nothing more.
 *
 * The price is the 7-day window, where a full-width slot is ~157px and the
 * columns are drawn as slabs. A `maxBarThickness: 48` was written here against
 * exactly that, and never did anything: it is Chart.js's option, not one
 * ApexCharts reads, and this library has no absolute cap at all. Capping it for
 * real means a px `columnWidth` (ApexCharts takes one when the string has no
 * `%`), which then has to come back to a percentage below `sm` or seven 48px
 * columns overlap on a phone. Left as it is: the slabs are legible, and the
 * range this chart is opened on is 30 days. */
const COLUMN_WIDTH = "90%";

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

const hasData = computed(() => props.daily.some((day) => day.total > 0));

const subtitle = computed(() => {
  const total = props.daily.reduce((sum, day) => sum + day.total, 0);
  return `${total} zmian w ${props.daily.length} dniach, po rodzaju działania`;
});

const reversed = computed(() => [...props.daily].reverse());

const series = computed(() =>
  activityKinds.map((kind) => ({
    name: activityKindLabels[kind],
    data: props.daily.map((day) => day.counts[kind]),
  })),
);

const options = computed(() => {
  const base = baseChartOptions();
  const labelEveryCap = props.daily.length <= DIRECT_LABEL_LIMIT;

  return {
    ...base,
    chart: { ...base.chart, type: "bar", stacked: true },
    colors: activityKinds.map((kind) => activityColors[kind]),
    ...barPlotOptions(),
    stroke: { ...barPlotOptions().stroke, width: SEGMENT_GAP_PX },
    plotOptions: {
      bar: {
        ...barPlotOptions().plotOptions.bar,
        columnWidth: COLUMN_WIDTH,
        // The running total on the cap, but only while the columns are far
        // enough apart for it to be read.
        dataLabels: {
          total: {
            enabled: labelEveryCap,
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
      categories: props.daily.map((day) => formatDayLabel(day.date)),
      tickAmount: Math.min(props.daily.length, 12),
      labels: { ...base.xaxis.labels, rotate: 0, hideOverlappingLabels: true },
    },
    yaxis: {
      ...base.yaxis,
      title: { text: "Liczba zmian", style: { color: ink.muted } },
      // Whole changes only; a fractional tick on a count is nonsense.
      forceNiceScale: true,
      labels: {
        ...base.yaxis.labels,
        formatter: (value: number) => String(Math.round(value)),
      },
    },
    tooltip: { ...base.tooltip, shared: true, intersect: false },
  };
});
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>

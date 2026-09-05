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
    plotOptions: {
      bar: {
        ...barPlotOptions().plotOptions.bar,
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

<template>
  <StatsChartCard :title="title" :subtitle="subtitle" :loading="loading">
    <template #chart>
      <ClientOnly>
        <apexchart
          v-if="total > 0"
          type="bar"
          height="280"
          :options="options"
          :series="series"
        />
        <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">
          Nikt jeszcze nie oddał głosu w tej kategorii.
        </div>
        <template #fallback>
          <v-skeleton-loader type="image" height="280" />
        </template>
      </ClientOnly>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Ocena</th>
            <th class="text-left">Znaczenie</th>
            <th class="text-right">Liczba głosów</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="step in steps" :key="step.value">
            <td class="stats-numeric">{{ step.signed }}</td>
            <td class="text-medium-emphasis">{{ step.meaning ?? "—" }}</td>
            <td class="text-right stats-numeric">{{ step.count }}</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { VoteCategory } from "~~/shared/model";
import { voteLevelLabel } from "~/composables/votes";
import {
  barPlotOptions,
  baseChartOptions,
  diverging,
  formatCount,
  ink,
} from "~/utils/chartTheme";

/** How a category's verdicts fall on the -5..+5 scale.
 *
 * Polarity is the whole point, so this is the method's diverging case: a warm
 * and a cool pole that read as opposite. Zero is not a step on the scale - it
 * means the voter has no opinion - so the axis runs -5..-1, 1..5 and there is
 * no midpoint mark to get wrong: the hue flips where the sign does.
 */
const props = defineProps<{
  title: string;
  category: VoteCategory;
  /** Count per step, keyed by the step as a string. */
  counts: Record<string, number> | undefined;
  loading?: boolean;
}>();

const SCALE = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];

const steps = computed(() =>
  SCALE.map((value) => ({
    value,
    signed: value > 0 ? `+${value}` : String(value),
    meaning: voteLevelLabel(props.category, value),
    count: props.counts?.[String(value)] ?? 0,
  })),
);

const total = computed(() =>
  steps.value.reduce((sum, step) => sum + step.count, 0),
);

const subtitle = computed(() => {
  const positive = steps.value
    .filter((s) => s.value > 0)
    .reduce((sum, s) => sum + s.count, 0);
  if (total.value === 0) return "Brak głosów";
  return `${formatCount(total.value)} pojedynczych ocen, ${Math.round(
    (positive / total.value) * 100,
  )}% na plus`;
});

const series = computed(() => [
  { name: "Liczba głosów", data: steps.value.map((step) => step.count) },
]);

const options = computed(() => {
  const base = baseChartOptions();
  return {
    ...base,
    ...barPlotOptions(),
    plotOptions: {
      bar: {
        ...barPlotOptions().plotOptions.bar,
        distributed: true,
        // Above the cap, not buried in the fill: the value has to stay legible
        // on a short bar and on a tall one alike.
        dataLabels: { position: "top" },
      },
    },
    // Colour carries the sign; length carries the count.
    colors: steps.value.map((step) =>
      step.value < 0 ? diverging.negative : diverging.positive,
    ),
    legend: { show: false },
    // Ten bars, so the value rides each one and the y-axis can go away -
    // direct labels before gridlines.
    dataLabels: {
      enabled: true,
      offsetY: -18,
      style: { colors: [ink.secondary], fontSize: "11px", fontWeight: 500 },
      background: { enabled: false },
    },
    grid: { ...base.grid, show: false, padding: { top: 12 } },
    xaxis: {
      ...base.xaxis,
      categories: steps.value.map((step) => step.signed),
      title: { text: "Ocena", style: { color: ink.muted } },
    },
    yaxis: { show: false },
    tooltip: {
      ...base.tooltip,
      y: {
        title: { formatter: () => "Głosów:" },
      },
      x: {
        formatter: (_value: unknown, opts?: { dataPointIndex?: number }) => {
          const step = steps.value[opts?.dataPointIndex ?? 0];
          if (!step) return "";
          return step.meaning
            ? `${step.signed} — ${step.meaning}`
            : step.signed;
        },
      },
    },
  };
});
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>

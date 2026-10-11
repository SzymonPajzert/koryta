<template>
  <BlogEmbedError v-if="!embed.success" name="chart" :errors="embed.errors" />
  <figure v-else-if="chart" class="blog-chart my-6" data-testid="blog-chart">
    <StatsChartCard :title="chart.title" :subtitle="chart.subtitle">
      <template #chart>
        <ClientOnly>
          <apexchart
            :type="chart.type"
            :height="height"
            :options="options"
            :series="chart.series"
          />
          <template #fallback>
            <v-skeleton-loader type="image" :height="height" />
          </template>
        </ClientOnly>
      </template>

      <template #table>
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left" />
              <th
                v-for="series in chart.series"
                :key="series.name"
                class="text-right"
              >
                {{ series.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(category, i) in chart.categories" :key="category">
              <td>{{ category }}</td>
              <td
                v-for="series in chart.series"
                :key="series.name"
                class="text-right blog-chart__number"
              >
                {{ formatCount(series.data[i]) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </StatsChartCard>
    <figcaption
      v-if="chart.source"
      class="text-caption text-medium-emphasis mt-2"
    >
      Źródło: {{ chart.source }}
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  barPlotOptions,
  baseChartOptions,
  categorical,
  formatCount,
  ink,
} from "~/utils/chartTheme";

/** `::chart` - bars or a line, with the table of its numbers a click away.
 *
 * Series take the categorical slots in their fixed order, never a hue picked
 * for the series: the order is what was checked for colourblind readers, and
 * the schema stops a post at the eighth. Three of the slots are under 3:1 on
 * white, which the method allows only with the numbers readable some other
 * way - here, the table behind the toggle. One series is named by the title
 * and draws no legend; two and more get one. */
defineOptions({ inheritAttrs: false });

const embed = useBlogEmbed("chart");
const chart = embed.success ? embed.data : null;

const horizontal = chart?.type === "bar" && chart.horizontal;

/** Room per category for a horizontal chart, so that long names and many
 * series both keep their bars a readable thickness. */
const barsPerCategory = chart?.stacked ? 1 : (chart?.series.length ?? 1);
const height = horizontal
  ? 48 + (chart?.categories.length ?? 0) * (18 + 20 * barsPerCategory)
  : 300;

const withUnit = (value: number) =>
  chart?.unit ? `${formatCount(value)} ${chart.unit}` : formatCount(value);

const options = computed(() => {
  if (!chart) return {};
  const base = baseChartOptions();
  const valueLabels = {
    ...base.yaxis.labels,
    formatter: (value: number) => formatCount(value),
  };
  return {
    ...base,
    ...(chart.type === "bar"
      ? barPlotOptions({ horizontal })
      : {
          stroke: { width: 2, curve: "straight" },
          // 8px across with the 2px surface ring, so a point stays visible
          // where two lines cross.
          markers: { size: 4, strokeWidth: 2, strokeColors: ink.surface },
        }),
    chart: { ...base.chart, stacked: chart.stacked },
    colors: categorical.slice(0, chart.series.length),
    legend: { ...base.legend, show: chart.series.length > 1 },
    grid: {
      ...base.grid,
      // Lines across the value axis only: vertical ones under horizontal bars.
      xaxis: { lines: { show: horizontal } },
      yaxis: { lines: { show: !horizontal } },
    },
    xaxis: {
      ...base.xaxis,
      categories: chart.categories,
      labels: horizontal
        ? {
            ...base.xaxis.labels,
            formatter: (value: string) => formatCount(Number(value)),
          }
        : base.xaxis.labels,
    },
    yaxis: horizontal
      ? { labels: { ...base.yaxis.labels, maxWidth: 240 } }
      : { labels: valueLabels },
    tooltip: {
      ...base.tooltip,
      y: { formatter: withUnit },
    },
    // On a phone a horizontal chart is ~300px across, and names given 240 of
    // them left the bars a sliver. Cut shorter there; the table and the
    // tooltip have them whole.
    responsive: horizontal
      ? [
          {
            breakpoint: 600,
            options: { yaxis: { labels: { maxWidth: 96 } } },
          },
        ]
      : [],
  };
});
</script>

<style scoped>
.blog-chart {
  margin-inline: 0;
}

.blog-chart__number {
  font-variant-numeric: tabular-nums;
}
</style>

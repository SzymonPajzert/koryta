<template>
  <div data-testid="party-stack-panel">
    <!-- Above the card rather than in it: a category with too few dates
       swaps the card for a message, and the way back has to stay. -->
    <v-select
      v-model="picked"
      :items="CATEGORY_ITEMS"
      :prepend-inner-icon="picked === ALL ? mdiDomain : categoryIcon(picked)"
      class="mb-4"
      data-testid="party-stack-category"
      density="compact"
      hide-details
      label="Typ podmiotu"
      max-width="360"
      variant="outlined"
    />

    <StatsChartCard
      v-if="hasData"
      data-testid="party-stack"
      :title="title"
      :subtitle="subtitle"
      :loading="status === 'pending'"
      hide-view-toggle-on-mobile
    >
      <template #chart>
        <apexchart
          type="area"
          :height="CHART_HEIGHT"
          :options="options"
          :series="series"
          data-testid="party-stack-chart"
        />
      </template>

      <template #table>
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left">Miesiąc</th>
              <th v-for="band in bands" :key="band.key" class="text-right">
                {{ band.label }}
              </th>
              <th class="text-right">Razem</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows" :key="row.month">
              <td>{{ row.label }}</td>
              <td
                v-for="band in bands"
                :key="band.key"
                class="text-right party-stack-numeric"
              >
                {{ formatPeople(band.counts[row.index] ?? 0) }}
              </td>
              <td class="text-right font-weight-medium party-stack-numeric">
                {{ formatCount(totals[row.index] ?? 0) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </StatsChartCard>

    <v-alert
      v-else-if="status === 'error'"
      data-testid="party-stack-error"
      text="Nie udało się wczytać wykresu. Odśwież stronę."
      type="warning"
      variant="tonal"
    />
    <v-alert
      v-else-if="status !== 'pending'"
      data-testid="party-stack-empty"
      text="Nie mamy jeszcze dość dat, żeby narysować ten wykres."
      type="info"
      variant="tonal"
    />
    <v-skeleton-loader v-else type="image" :height="CHART_HEIGHT" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiDomain } from "@mdi/js";
import {
  polishCountingGenitive,
  polishCountingGrouped,
} from "~/composables/polish";
import { categoryTitle, companyCategories } from "~~/shared/companyCategories";
import { OTHER_PARTY, partyColors } from "~~/shared/misc";
import { categoryIcon } from "~/utils/categoryIcons";
import {
  baseChartOptions,
  formatCount,
  formatPeople,
  ink,
  stackTooltip,
} from "~/utils/chartTheme";
import type { PartyStackResponse } from "~~/server/api/stats/partyStack.get";

/** How many people held a post each month, one band per party, stacked: in
 * every institution, or in one category of them.
 *
 * A stack, unlike the home page's lines, because here the bands do add up:
 * the server counts each person once in all, a person with two parties half
 * in each (`partyBands`), so the top edge is the headcount. The parties wear
 * their own fills, in the site's party order from the axis up, and „Inne
 * partie” is grey on top. As on the home chart, identity never rests on
 * colour alone: the legend, the tooltip and the table name every band. */

const CHART_HEIGHT = 400;

/** The category the chart is cut to, as `?category=` holds it on the other
 * /eksploruj views; null for every institution. */
const category = defineModel<string | null>("category");

/** What the select shows for no category. Not a value a category can take. */
const ALL = "__all__";

const CATEGORY_ITEMS = [
  { title: "Wszystkie instytucje", value: ALL },
  ...companyCategories.map(({ title, value }) => ({ title, value })),
];

const picked = computed({
  get: () =>
    CATEGORY_ITEMS.some((item) => item.value === category.value)
      ? category.value!
      : ALL,
  set: (value: string) => {
    category.value = value === ALL ? null : value;
  },
});

/** The card names its category too: a screenshot of the card alone, which is
 * how a chart like this gets shared, keeps it. */
const title = computed(() =>
  picked.value === ALL
    ? "Stanowiska wg partii"
    : `Stanowiska wg partii: ${categoryTitle(picked.value)}`,
);

/** A key per category, so going back to one already seen draws at once. */
const { data, status } = useFetch<PartyStackResponse>("/api/stats/partyStack", {
  key: computed(() => `party-stack-${picked.value}`),
  query: computed(() =>
    picked.value === ALL ? {} : { category: picked.value },
  ),
});

const months = computed(() => data.value?.months ?? []);
const bands = computed(() => data.value?.series ?? []);

/** Two months at least: a datetime axis over a single month spans a few
 * hours either side of it, and the area is a line nobody can see. */
const hasData = computed(
  () => bands.value.length > 0 && months.value.length > 1,
);

/** Top of the stack first, as the bands stand: how the tooltip reads. */
const bandsTopFirst = computed(() => [...bands.value].reverse());

/** Whole people: the parts of a person add up to one, and rounding takes off
 * what summing the parts left behind. */
const totals = computed(() =>
  months.value.map((_, index) =>
    Math.round(
      bands.value.reduce((sum, band) => sum + (band.counts[index] ?? 0), 0),
    ),
  ),
);

/** A count and its noun kept on one line: „870 osób”, never „870” at a
 * line's end and „osób” on the next. */
function glued(counted: string): string {
  return counted.replace(/ (\S+)$/, "\u00a0$1");
}

function people(count: number): string {
  return glued(polishCountingGrouped(count, "osoba", "osoby", "osób"));
}

const subtitle = computed(() => {
  const coverage = data.value?.coverage;
  const posts = data.value?.posts;
  if (!coverage || !posts) return "";
  const counted =
    coverage.posts === posts
      ? glued(
          polishCountingGrouped(posts, "stanowisko", "stanowiska", "stanowisk"),
        )
      : `${formatCount(coverage.posts)}\u00a0z\u00a0${glued(
          polishCountingGenitive(posts, "stanowiska", "stanowisk"),
        )}`;
  return (
    "Ile osób z każdej partii było w danym miesiącu na stanowisku. " +
    "Osoby z kilkoma partiami dzielimy po równo. " +
    `${people(coverage.people)} i ${counted} na koryta.pl.`
  );
});

function bandColour(key: string): string {
  if (key === OTHER_PARTY) return partyColors[OTHER_PARTY]!;
  return partyColors[key] ?? ink.muted;
}

const colors = computed(() => bands.value.map((band) => bandColour(band.key)));

/** A `YYYY-MM` as the UTC instant its first day began. */
function monthStart(month: string): number {
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
}

const MONTH_AND_YEAR = new Intl.DateTimeFormat("pl-PL", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-11` as „Listopad 2026”. */
function monthLabel(month: string): string {
  const label = MONTH_AND_YEAR.format(new Date(monthStart(month)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const series = computed(() =>
  bands.value.map((band) => ({
    name: band.label,
    data: months.value.map((month, index) => ({
      x: monthStart(month),
      y: band.counts[index] ?? 0,
    })),
  })),
);

const tooltip = stackTooltip(
  (index) =>
    bandsTopFirst.value.map((band) => ({
      name: band.label,
      color: bandColour(band.key),
      value: band.counts[index] ?? 0,
    })),
  (index, total) => {
    const month = months.value[index];
    return month ? `${monthLabel(month)}: ${people(Math.round(total))}` : "";
  },
);

const options = computed(() => {
  const base = baseChartOptions();
  const first = months.value[0];
  const last = months.value[months.value.length - 1];
  return {
    ...base,
    colors: colors.value,
    chart: { ...base.chart, type: "area" as const, stacked: true },
    legend: { ...base.legend, onItemClick: { toggleDataSeries: false } },
    // A thin line in the surface colour between two bands, so that two dark
    // fills meet at an edge rather than run together.
    stroke: { curve: "straight" as const, width: 1, colors: [ink.surface] },
    // Opaque: apexcharts draws every band down to the axis, under the ones
    // below it, so a see-through fill shows the next party's colour through.
    fill: { type: "solid", opacity: 1 },
    markers: { size: 0, hover: { size: 0 } },
    xaxis: {
      ...base.xaxis,
      type: "datetime" as const,
      min: first ? monthStart(first) : undefined,
      max: last ? monthStart(last) : undefined,
      crosshairs: { show: true, stroke: { color: ink.axis, width: 1 } },
      tooltip: { enabled: false },
      labels: {
        ...base.xaxis.labels,
        datetimeUTC: true,
        datetimeFormatter: { year: "yyyy", month: "MMM 'yy", day: "d MMM" },
      },
    },
    yaxis: {
      ...base.yaxis,
      min: 0,
      forceNiceScale: true,
      labels: {
        ...base.yaxis.labels,
        formatter: (value: number) => formatCount(Math.round(value)),
      },
    },
    tooltip: {
      ...base.tooltip,
      shared: true,
      intersect: false,
      custom: tooltip,
    },
  };
});

/** One row a year, at its last month, and the newest month last: the
 * number a reader most likely came for. */
const tableRows = computed(() =>
  months.value.flatMap((month, index) => {
    const next = months.value[index + 1];
    if (next && next.slice(0, 4) === month.slice(0, 4)) return [];
    return [
      {
        index,
        month,
        label: next ? month.slice(0, 4) : monthLabel(month),
      },
    ];
  }),
);
</script>

<style scoped>
.party-stack-numeric {
  font-variant-numeric: tabular-nums;
}
</style>

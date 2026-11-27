<template>
  <div data-testid="party-stack-panel">
    <!-- One row above the card, so a shot of the panel shows both choices
         at once (decision on 2026-11-27), and the way back from a category
         with too few dates, which swaps the card for a message, stays. The
         years narrow the chart and its table alike. -->
    <div class="party-stack-controls mb-4">
      <v-select
        v-model="picked"
        :items="CATEGORY_ITEMS"
        :prepend-inner-icon="picked === ALL ? mdiDomain : categoryIcon(picked)"
        class="party-stack-controls__category"
        data-testid="party-stack-category"
        density="compact"
        hide-details
        label="Typ podmiotu"
        variant="outlined"
      />
      <v-range-slider
        v-if="bounds"
        :model-value="shownYears"
        :max="bounds[1]"
        :min="bounds[0]"
        :step="1"
        class="party-stack-controls__years"
        color="ink-sage"
        data-testid="party-stack-years"
        density="compact"
        hide-details
        label="Lata"
        strict
        thumb-label
        @update:model-value="slide"
      >
        <template #append>
          <span
            class="party-stack-numeric text-body-2"
            data-testid="party-stack-years-shown"
          >
            {{ shownYears[0] }} - {{ shownYears[1] }}
          </span>
        </template>
      </v-range-slider>
    </div>

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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mdiDomain } from "@mdi/js";
import {
  polishCountingGenitive,
  polishCountingGrouped,
} from "~/composables/polish";
import { companyCategories } from "~~/shared/companyCategories";
import { partyStackHeading } from "~~/shared/partyStackCard";
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

/** The category the chart is cut to, as `?kategoria=` holds it; null for
 * every institution. */
const category = defineModel<string | null>("category");

/** The years the chart is narrowed to, both ends kept, as `?od=` and `?do=`
 * hold them; null for every year there is data for. */
const years = defineModel<[number, number] | null>("years", {
  default: null,
});

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
  partyStackHeading(picked.value === ALL ? null : picked.value),
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

/** The first and last year there is data for, kept while another category
 * loads, so the slider does not leave the row and take it back. */
const bounds = ref<[number, number] | null>(null);
watch(
  months,
  (all) => {
    if (all.length > 1) {
      bounds.value = [
        Number(all[0]!.slice(0, 4)),
        Number(all.at(-1)!.slice(0, 4)),
      ];
    }
  },
  { immediate: true },
);
const firstYear = computed(() => bounds.value?.[0] ?? 0);
const lastYear = computed(() => bounds.value?.[1] ?? 0);

/** Where the thumbs are. The slider's own, moved at once, rather than read
 * back from the url: a key pressed before the router had caught up with the
 * last one started from the old year again, so thirteen presses moved one. */
const moved = ref<[number, number] | null>(years.value);

/** How long the url waits after the thumbs stop. A drag or a run of keys is
 * then one replace, not one per year. */
const URL_DELAY_MS = 400;
let writing: ReturnType<typeof setTimeout> | undefined;

// Back and Forward move the url without the slider; they are followed
// unless one of the slider's own writes is still on its way.
watch(years, (now) => {
  if (!writing) moved.value = now;
});

/** The years on screen, inside the ones there is data for. */
const shownYears = computed<[number, number]>(() => {
  const [from, to] = moved.value ?? [firstYear.value, lastYear.value];
  const start = Math.min(Math.max(from, firstYear.value), lastYear.value);
  return [start, Math.max(Math.min(to, lastYear.value), start)];
});

/** Every year is no narrowing at all, and leaves the url clean. */
function slide(value: [number, number]) {
  moved.value = value;
  clearTimeout(writing);
  writing = setTimeout(() => {
    writing = undefined;
    years.value =
      value[0] <= firstYear.value && value[1] >= lastYear.value ? null : value;
  }, URL_DELAY_MS);
}

onBeforeUnmount(() => clearTimeout(writing));

/** The months the years cover, as indexes into the response's arrays. Two at
 * least: a datetime axis over one month spans a few hours and draws nothing,
 * which is what a January would get from the current year alone. */
const visible = computed(() => {
  const [from, to] = shownYears.value;
  const first = months.value.findIndex(
    (month) => Number(month.slice(0, 4)) >= from,
  );
  let start = first === -1 ? 0 : first;
  let end = months.value.length - 1;
  while (end > start && Number(months.value[end]!.slice(0, 4)) > to) end -= 1;
  if (end === start && start > 0) start -= 1;
  return { from: start, months: months.value.slice(start, end + 1) };
});

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
    data: visible.value.months.map((month, index) => ({
      x: monthStart(month),
      y: band.counts[visible.value.from + index] ?? 0,
    })),
  })),
);

/** Read at the moment it is drawn: apexcharts keeps calling the first
 * tooltip it was given, so a narrowed window has to be looked up, not baked
 * in. */
const tooltip = stackTooltip(
  (index) =>
    bandsTopFirst.value.map((band) => ({
      name: band.label,
      color: bandColour(band.key),
      value: band.counts[visible.value.from + index] ?? 0,
    })),
  (index, total) => {
    const month = visible.value.months[index];
    return month ? `${monthLabel(month)}: ${people(Math.round(total))}` : "";
  },
);

const options = computed(() => {
  const base = baseChartOptions();
  // Both ends from the window drawn: apexcharts works a datetime axis out
  // once and keeps it, so a narrowed window would land on the old years.
  const first = visible.value.months[0];
  const last = visible.value.months.at(-1);
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
    // No label formatter: vue3-apexcharts hands every later update through
    // JSON, which drops functions, and after the first change of years the
    // ticks came out as „400.000”, the bands' parts of a person making
    // apexcharts write three decimals. A plain option survives the trip.
    yaxis: { ...base.yaxis, min: 0, forceNiceScale: true, decimalsInFloat: 0 },
    tooltip: {
      ...base.tooltip,
      shared: true,
      intersect: false,
      custom: tooltip,
    },
  };
});

/** One row a year of the window, at its last month, and the newest month by
 * its name: the number a reader most likely came for. */
const tableRows = computed(() =>
  visible.value.months.flatMap((month, offset) => {
    const next = visible.value.months[offset + 1];
    if (next && next.slice(0, 4) === month.slice(0, 4)) return [];
    const index = visible.value.from + offset;
    return [
      {
        index,
        month,
        label:
          index === months.value.length - 1
            ? monthLabel(month)
            : month.slice(0, 4),
      },
    ];
  }),
);
</script>

<style scoped>
.party-stack-numeric {
  font-variant-numeric: tabular-nums;
}

/* The category and the years side by side; on a phone the years go under. */
.party-stack-controls {
  align-items: center;
  column-gap: 32px;
  display: flex;
  flex-wrap: wrap;
  row-gap: 8px;
}

.party-stack-controls__category {
  flex: 0 1 360px;
  min-width: 260px;
}

.party-stack-controls__years {
  flex: 1 1 320px;
  max-width: 560px;
}
</style>

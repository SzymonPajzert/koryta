<template>
  <StatsChartCard
    title="Jak kończą się wyszukiwania"
    :subtitle="subtitle"
    :loading="loading"
    data-testid="search-endings"
  >
    <!-- How the window is drawn, not what it holds: the chart and its table
         both follow them. -->
    <template v-if="columns.length" #controls>
      <div class="d-flex flex-wrap ga-3">
        <v-btn-toggle
          v-model="period"
          mandatory
          density="compact"
          variant="outlined"
          divided
          data-testid="search-endings-period"
        >
          <v-btn value="day" size="small">Dni</v-btn>
          <v-btn value="week" size="small">Tygodnie</v-btn>
        </v-btn-toggle>
        <v-btn-toggle
          v-model="scale"
          mandatory
          density="compact"
          variant="outlined"
          divided
          data-testid="search-endings-scale"
        >
          <v-btn value="count" size="small">Liczba</v-btn>
          <v-btn value="share" size="small">Udział</v-btn>
        </v-btn-toggle>
      </div>
    </template>

    <template #chart>
      <!-- Before the first answer, a placeholder: an empty list would say
           nobody searched. -->
      <v-skeleton-loader v-if="!daily" type="heading, image" height="440" />
      <template v-else>
        <!-- The tiles are the chart's key as well as its headline: each names
             a band beside its colour, so the chart draws no legend of its own.
             The share of searches that opened something leads, at the hero
             size: it is the one number that says how well the box works, and
             the two ways it fails are what makes up the rest. -->
        <div
          v-if="totals.all > 0"
          class="d-flex flex-wrap align-end gc-8 gr-4 mb-4"
        >
          <StatsStatTile
            v-for="tile in tiles"
            :key="tile.ending"
            :label="tile.label"
            :tooltip="tile.tooltip"
            :color="tile.color"
            :value="tile.percent"
            unit="%"
            :hint="tile.hint"
            :hero="tile.ending === 'opened'"
            :class="
              tile.ending === 'opened'
                ? 'search-endings__hero'
                : 'search-endings__tile'
            "
            :data-testid="`search-endings-${tile.ending}`"
          />
        </div>
        <StatsDailyColumns
          :dates="columns.map((column) => column.date)"
          :ends="
            period === 'week' ? columns.map((column) => column.last) : undefined
          "
          :bands="bands"
          :legend="false"
          :shares="scale === 'share'"
          :value-title="
            scale === 'share' ? 'Udział wyszukiwań' : 'Wyszukiwania'
          "
          empty-text="W tym okresie nikt niczego nie szukał."
        />
      </template>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">
              {{ period === "week" ? "Tydzień" : "Dzień" }}
            </th>
            <th
              v-for="ending in SEARCH_ENDINGS"
              :key="ending"
              class="text-right"
            >
              {{ ENDING_LABELS[ending] }}
            </th>
            <th class="text-right">Razem</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="column in newestFirst" :key="column.date">
            <td class="text-no-wrap">
              {{ formatDayRange(column.date, column.last) }}
            </td>
            <td
              v-for="ending in SEARCH_ENDINGS"
              :key="ending"
              class="text-right stats-numeric"
            >
              {{
                scale === "share"
                  ? formatPercent(column.counts[ending], column.total)
                  : column.counts[ending]
              }}
            </td>
            <td class="text-right font-weight-medium stats-numeric">
              {{ column.total }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  SEARCH_ENDINGS,
  searchWeeks,
  type SearchDay,
  type SearchEnding,
  type SearchEndingCounts,
  type SearchPeriod,
} from "~~/shared/searchLog";
import { polishNumber } from "~/composables/polish";
import {
  formatDayLabel,
  formatDayRange,
  formatPercent,
  searchEndingColors,
} from "~/utils/chartTheme";

/** How well the search box serves the people who type into it: every search
 * of the window, counted once by how it ended - a result opened, results
 * nobody opened, or nothing found. The two failures are the two different
 * fixes: nothing found is a page the site lacks or a spelling the search does
 * not forgive, results nobody opened are the wrong hits.
 *
 * Shares by day to begin with, Szymon's pick on the design board of
 * 2026-10-28: the share is what says whether the box got better. A day is a
 * handful of searches, though - one search makes a whole column - so the
 * day's count rides on its cap while the columns are few enough to label,
 * and counts and weeks are a click away: a week is enough searches for its
 * shares to settle. */
const props = defineProps<{
  /** Undefined until the first answer arrives. */
  daily?: SearchDay[];
  /** Count only the searches of people not signed in. */
  signedOutOnly: boolean;
  loading?: boolean;
}>();

const period = ref<"day" | "week">("day");
const scale = ref<"count" | "share">("share");

const ENDING_LABELS: Record<SearchEnding, string> = {
  opened: "Otwarto wynik",
  notOpened: "Znaleziono, nic nie otwarto",
  nothing: "Nic nie znaleziono",
};

const ENDING_TOOLTIPS: Record<SearchEnding, string> = {
  opened:
    "Czytelnik otworzył coś z listy: osobę, instytucję, region albo skrót do partii czy listy wszystkich osób.",
  notOpened:
    "Wyszukiwarka coś znalazła, ale czytelnik niczego nie otworzył: wpisał coś innego, zostawił pole albo zaproponował dodanie kogoś.",
  nothing:
    "Wyszukiwarka nic nie znalazła. Czytelnik zostawił pole albo zaproponował dodanie tego, czego szukał.",
};

/** The columns: days, or the weeks they add up to. */
const periods = computed<SearchPeriod[]>(() => {
  const daily = props.daily ?? [];
  return period.value === "week"
    ? searchWeeks(daily)
    : daily.map((day) => ({ ...day, last: day.date }));
});

/** The columns as the switch above the page has them: everybody's searches,
 * or only the signed out readers'. */
const columns = computed(() =>
  periods.value.map((column) => {
    const counts: SearchEndingCounts = props.signedOutOnly
      ? column.signedOut
      : column.all;
    return {
      date: column.date,
      last: column.last,
      counts,
      total: SEARCH_ENDINGS.reduce((sum, ending) => sum + counts[ending], 0),
    };
  }),
);

const newestFirst = computed(() => [...columns.value].reverse());

const totals = computed(() => {
  const sums = Object.fromEntries(
    SEARCH_ENDINGS.map((ending) => [
      ending,
      columns.value.reduce((sum, column) => sum + column.counts[ending], 0),
    ]),
  ) as SearchEndingCounts;
  return {
    ...sums,
    all: SEARCH_ENDINGS.reduce((sum, ending) => sum + sums[ending], 0),
  };
});

const bands = computed(() =>
  SEARCH_ENDINGS.map((ending) => ({
    key: ending,
    label: ENDING_LABELS[ending],
    color: searchEndingColors[ending],
    values: columns.value.map((column) => column.counts[ending]),
  })),
);

const tiles = computed(() =>
  SEARCH_ENDINGS.map((ending) => {
    const count = totals.value[ending];
    const all = totals.value.all;
    return {
      ending,
      label: ENDING_LABELS[ending],
      tooltip: ENDING_TOOLTIPS[ending],
      color: searchEndingColors[ending],
      percent: all ? Math.round((count / all) * 100) : 0,
      hint: `${polishNumber(count)} z ${polishNumber(all)}`,
    };
  }),
);

/** When the chart starts, which is not always the window's first day: the
 * log is younger than the longest windows. How many searches there were is
 * said once, above the card. */
const subtitle = computed(() => {
  const by = period.value === "week" ? "Tydzień po tygodniu" : "Dzień po dniu";
  const first = columns.value[0]?.date;
  return first ? `${by}, od ${formatDayLabel(first)}` : by;
});
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}

/* The hero takes a row of its own on a phone, with the two failures side by
   side under it, their labels wrapping, rather than a column of three. */
@media (max-width: 599.98px) {
  .search-endings__hero {
    flex-basis: 100%;
  }

  .search-endings__tile {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
